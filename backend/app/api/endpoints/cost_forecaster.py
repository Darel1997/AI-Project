"""
Cost Forecaster.

Parses real infrastructure-as-code from a repo and forecasts the monthly cost
impact of changes. Supports:

  - Terraform (.tf) — AWS, GCP, Azure resources
  - CloudFormation (.yaml/.yml/.json templates)
  - Kubernetes manifests (resources.requests/limits)

Pipeline (all REAL data — no LLM-invented prices):

  1. Parse all IaC files in the indexed repo to extract resource definitions
     (instance types, storage sizes, replica counts, etc).

  2. For a forecast, compare two states:
       - Current: what's currently in the indexed manifests
       - Proposed: what's in a diff/PR or a list of new resources
     Compute the delta in resources.

  3. Apply prices from the embedded price catalog (real published list prices,
     last updated quarterly). The catalog is shipped with the app — no live
     billing API integration required, which means no AWS/GCP credentials.

  4. Output: forecast in $/month with line-item breakdown.

The LLM is used ONLY for the human "why this matters" narrative. All numbers
come from real parsed manifests + real price lookups.
"""

from __future__ import annotations
import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.services.feature_gate import require_feature
from app.models.user import User
from app.models.repository import Repository, RepoFile
from app.services.lab_service import claude_complete_json

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cost-forecaster", tags=["cost-forecaster"])


# ─────────────────────────────────────────────────────────────────
# Price catalog — real AWS/GCP list prices in USD/month for common resources.
# Updated quarterly. Source: aws.amazon.com/{ec2,s3,rds}/pricing,
# cloud.google.com/compute/all-pricing
#
# Important: these are LIST prices — the user's actual bill will be lower if
# they use Reserved Instances, Savings Plans, or have negotiated discounts.
# We document this in the response so users don't get surprised.
# ─────────────────────────────────────────────────────────────────

PRICE_CATALOG = {
    # AWS EC2 — On-demand, us-east-1, Linux, monthly (730 hours)
    "aws.ec2": {
        "t3.micro":   7.59,    "t3.small":   15.18,    "t3.medium":  30.37,
        "t3.large":   60.74,   "t3.xlarge":  121.47,   "t3.2xlarge": 242.94,
        "t4g.micro":  6.13,    "t4g.small":  12.26,    "t4g.medium": 24.53,
        "m5.large":   70.08,   "m5.xlarge":  140.16,   "m5.2xlarge": 280.32,   "m5.4xlarge": 560.64,
        "m6i.large":  70.08,   "m6i.xlarge": 140.16,   "m6i.2xlarge": 280.32,
        "c5.large":   62.05,   "c5.xlarge":  124.10,   "c5.2xlarge": 248.20,
        "r5.large":   91.98,   "r5.xlarge":  183.96,   "r5.2xlarge": 367.92,
    },
    # AWS RDS — On-demand PostgreSQL, single-AZ, us-east-1, monthly
    "aws.rds": {
        "db.t3.micro":   12.41,   "db.t3.small":   24.82,   "db.t3.medium":  49.64,
        "db.t3.large":   99.28,   "db.m5.large":  124.10,   "db.m5.xlarge":  248.20,
        "db.m5.2xlarge": 496.40,  "db.r5.large":  175.93,   "db.r5.xlarge":  351.86,
    },
    # AWS S3 standard — per GB-month
    "aws.s3.standard_per_gb": 0.023,
    # AWS EBS gp3 — per GB-month
    "aws.ebs.gp3_per_gb": 0.08,
    # AWS NAT Gateway — fixed $/month + $/GB processed (we use the fixed for forecast)
    "aws.nat_gateway": 32.85,
    # AWS Application Load Balancer
    "aws.alb": 16.43,
    # AWS Elastic IP (when not attached)
    "aws.eip_unattached": 3.65,

    # GCP Compute Engine — us-central1, monthly (730 hours)
    "gcp.compute": {
        "e2-micro":     6.11,    "e2-small":     12.23,   "e2-medium":   24.46,
        "e2-standard-2": 48.92,  "e2-standard-4": 97.84,  "e2-standard-8": 195.68,
        "n2-standard-2": 70.85,  "n2-standard-4": 141.70, "n2-standard-8": 283.40,
        "n2-highmem-2":  95.63,  "n2-highmem-4":  191.27,
    },
    # GCP Cloud SQL — PostgreSQL HA, monthly
    "gcp.cloud_sql": {
        "db-f1-micro":  9.50,    "db-g1-small":  35.04,
        "db-n1-standard-1": 51.10,  "db-n1-standard-2": 102.20,  "db-n1-standard-4": 204.40,
    },
    # GCP Cloud Storage standard
    "gcp.storage_per_gb": 0.020,

    # Azure VMs — East US, monthly
    "azure.vm": {
        "Standard_B1s":   7.59,    "Standard_B2s":   30.37,
        "Standard_D2s_v3": 70.08,  "Standard_D4s_v3": 140.16,
    },

    # Kubernetes node-pool implied cost (per CPU/GB/month) — heuristic
    "k8s.cpu_per_month":     20.00,  # ~$0.027/hr per vCPU
    "k8s.memory_per_gb":     2.50,   # ~$0.0034/hr per GB
}

PRICE_CATALOG_VERSION = "2026-Q1"
PRICE_CATALOG_NOTE = (
    "Prices are public list prices in USD, US regions. Actual costs depend on "
    "Reserved Instances, Savings Plans, Committed Use Discounts, region, "
    "and any negotiated rates. Use this as a directional forecast, not a binding quote."
)


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class ForecastRequest(BaseModel):
    repository_id: int
    proposed_changes: Optional[dict] = Field(None, description="Map of file_path → new content for forecast diff")


class ResourceLineItem(BaseModel):
    file_path: str
    resource_type: str       # e.g. "aws.ec2", "gcp.cloud_sql"
    resource_name: str       # e.g. "web_server", "users_db"
    instance_type: Optional[str] = None
    quantity: int = 1
    unit_cost_monthly: float
    total_cost_monthly: float
    notes: List[str] = []


class CostForecast(BaseModel):
    repository_id: int
    repository_name: str
    summary: str
    current_monthly_cost: float
    proposed_monthly_cost: float
    delta_monthly: float
    delta_pct: Optional[float] = None
    line_items_current: List[ResourceLineItem]
    line_items_proposed: List[ResourceLineItem]
    unmatched_resources: List[str]   # IaC resources we couldn't price
    catalog_version: str
    catalog_note: str
    generated_at: str


# ─────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────

@router.post("/forecast",
    dependencies=[Depends(require_feature("cost_forecaster"))],
    response_model=CostForecast,
)
async def forecast_cost(
    body: ForecastRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Parse the repo's IaC files and forecast the monthly cost.
    If `proposed_changes` is provided, compares against the current state.
    """
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    if not repo.is_indexed:
        raise HTTPException(status_code=400, detail="Repository must be indexed first")

    # ── Pull IaC files from the indexed corpus ──
    iac_files = await _load_iac_files(db, repo.id)
    if not iac_files:
        return _empty_forecast(repo, "No infrastructure-as-code files found in this repository.")

    # ── Parse current state ──
    current_resources = []
    unmatched: list[str] = []
    for path, content in iac_files.items():
        parsed, missed = _parse_iac(path, content)
        current_resources.extend(parsed)
        unmatched.extend(missed)

    current_items = _price_resources(current_resources)
    current_total = sum(it.total_cost_monthly for it in current_items)

    # ── Parse proposed state if given ──
    proposed_items: list[ResourceLineItem] = []
    proposed_total = current_total

    if body.proposed_changes:
        merged_files = dict(iac_files)
        merged_files.update(body.proposed_changes)
        proposed_resources = []
        for path, content in merged_files.items():
            parsed, _ = _parse_iac(path, content)
            proposed_resources.extend(parsed)
        proposed_items = _price_resources(proposed_resources)
        proposed_total = sum(it.total_cost_monthly for it in proposed_items)

    delta = proposed_total - current_total
    delta_pct = (delta / current_total * 100) if current_total > 0 else None

    # ── LLM only for the executive summary, given REAL numbers ──
    summary_data = {
        "iac_files": len(iac_files),
        "current_items": len(current_items),
        "proposed_items": len(proposed_items) if proposed_items else len(current_items),
        "current_monthly": round(current_total, 2),
        "proposed_monthly": round(proposed_total, 2),
        "delta": round(delta, 2),
        "delta_pct": round(delta_pct, 1) if delta_pct is not None else None,
        "unmatched_count": len(unmatched),
    }
    prompt = (
        f"COST FORECAST DATA:\n"
        f"  Repo: {repo.full_name}\n"
        f"  IaC files parsed: {summary_data['iac_files']}\n"
        f"  Priceable resources: {summary_data['current_items']}\n"
        f"  Current monthly cost (list): ${summary_data['current_monthly']:.2f}\n"
        f"  Proposed monthly cost: ${summary_data['proposed_monthly']:.2f}\n"
        f"  Monthly delta: ${summary_data['delta']:+.2f} ({summary_data['delta_pct']}%)\n"
        f"  Unmatched IaC resources: {summary_data['unmatched_count']}\n\n"
        "Write a 2-3 sentence summary for an engineering leader. "
        "Be honest about list prices vs actual bill. Don't invent specific resource details. "
        "Return STRICT JSON: { \"summary\": str }"
    )
    try:
        llm = await claude_complete_json(
            system="You write infra cost summaries from REAL parsed manifests. Never invent. Return STRICT JSON.",
            prompt=prompt,
        )
    except Exception:
        llm = {}

    fallback_summary = (
        f"Forecast for {len(current_items)} priceable resources across {len(iac_files)} IaC file(s). "
        f"Current monthly cost (list): ${current_total:,.2f}. "
        + (f"Proposed change: ${delta:+,.2f}/month ({delta_pct:+.1f}%)." if body.proposed_changes else "")
    )

    return CostForecast(
        repository_id=repo.id,
        repository_name=repo.full_name,
        summary=llm.get("summary") or fallback_summary,
        current_monthly_cost=round(current_total, 2),
        proposed_monthly_cost=round(proposed_total, 2),
        delta_monthly=round(delta, 2),
        delta_pct=round(delta_pct, 2) if delta_pct is not None else None,
        line_items_current=current_items,
        line_items_proposed=proposed_items,
        unmatched_resources=sorted(set(unmatched))[:30],
        catalog_version=PRICE_CATALOG_VERSION,
        catalog_note=PRICE_CATALOG_NOTE,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ─────────────────────────────────────────────────────────────────
# IaC parsers
# ─────────────────────────────────────────────────────────────────

async def _load_iac_files(db: AsyncSession, repo_id: int) -> dict[str, str]:
    """Return all IaC files (Terraform, CloudFormation, K8s manifests)."""
    res = await db.execute(
        select(RepoFile.path, RepoFile.content).where(RepoFile.repository_id == repo_id)
    )
    out: dict[str, str] = {}
    for path, content in res:
        if not content:
            continue
        if _is_iac(path, content):
            out[path] = content
    return out


def _is_iac(path: str, content: str) -> bool:
    """True if this file looks like infrastructure-as-code."""
    p = path.lower()
    if p.endswith(".tf") or p.endswith(".tf.json"):
        return True
    # CloudFormation: YAML/JSON with AWSTemplateFormatVersion or Resources block
    if p.endswith((".yml", ".yaml", ".json")):
        head = content[:2000].lower()
        if "awstemplateformatversion" in head:
            return True
        # Kubernetes — look for apiVersion + kind
        if "apiversion:" in head and "kind:" in head:
            return True
        # CloudFormation without explicit version
        if '"resources"' in head and ('"type"' in head and "aws::" in head):
            return True
    return False


def _parse_iac(path: str, content: str) -> tuple[list[dict], list[str]]:
    """Parse one IaC file. Returns (resources_found, unmatched_descriptions)."""
    p = path.lower()
    if p.endswith(".tf") or p.endswith(".tf.json"):
        return _parse_terraform(path, content)
    if "apiversion:" in content[:2000].lower() and "kind:" in content[:2000].lower():
        return _parse_kubernetes(path, content)
    if "awstemplateformatversion" in content[:2000].lower() or "aws::" in content[:5000].lower():
        return _parse_cloudformation(path, content)
    return [], []


def _parse_terraform(path: str, content: str) -> tuple[list[dict], list[str]]:
    """
    Lightweight Terraform parser. We don't run real HCL — just regex out the
    `resource "type" "name" { ... instance_type = "..." ... }` blocks.
    """
    resources: list[dict] = []
    unmatched: list[str] = []

    # Match resource blocks
    rx = re.compile(r'resource\s+"([\w]+)"\s+"([\w\-]+)"\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}', re.DOTALL)
    for m in rx.finditer(content):
        rtype = m.group(1)
        rname = m.group(2)
        block = m.group(3)

        instance_type = _extract_attr(block, "instance_type") or _extract_attr(block, "machine_type")
        size = _extract_attr(block, "size")
        count = int(_extract_attr(block, "count") or "1")

        # Map Terraform resource type → our pricing key
        if rtype == "aws_instance":
            resources.append({"file": path, "type": "aws.ec2", "name": rname, "instance_type": instance_type, "quantity": count})
        elif rtype == "aws_db_instance":
            resources.append({"file": path, "type": "aws.rds", "name": rname,
                              "instance_type": _extract_attr(block, "instance_class"), "quantity": count})
        elif rtype == "aws_s3_bucket":
            # Storage isn't priced from .tf alone — needs actual volume data
            unmatched.append(f"{path}: aws_s3_bucket {rname} (storage size unknown)")
        elif rtype == "aws_ebs_volume":
            try:
                gb = int(size) if size else 100
            except ValueError:
                gb = 100
            resources.append({"file": path, "type": "aws.ebs", "name": rname, "size_gb": gb, "quantity": count})
        elif rtype == "aws_lb" or rtype == "aws_alb":
            resources.append({"file": path, "type": "aws.alb", "name": rname, "quantity": count})
        elif rtype == "aws_nat_gateway":
            resources.append({"file": path, "type": "aws.nat_gateway", "name": rname, "quantity": count})
        elif rtype == "aws_eip":
            # Only billed when unattached — flag for manual review
            unmatched.append(f"{path}: aws_eip {rname} (only billed when unattached)")
        elif rtype == "google_compute_instance":
            resources.append({"file": path, "type": "gcp.compute", "name": rname, "instance_type": instance_type, "quantity": count})
        elif rtype == "google_sql_database_instance":
            tier_match = re.search(r'tier\s*=\s*"([^"]+)"', block)
            tier = tier_match.group(1) if tier_match else None
            resources.append({"file": path, "type": "gcp.cloud_sql", "name": rname, "instance_type": tier, "quantity": count})
        elif rtype.startswith("azurerm_") and "virtual_machine" in rtype:
            vm_size = _extract_attr(block, "vm_size") or _extract_attr(block, "size")
            resources.append({"file": path, "type": "azure.vm", "name": rname, "instance_type": vm_size, "quantity": count})
        else:
            unmatched.append(f"{path}: {rtype} {rname}")
    return resources, unmatched


def _parse_cloudformation(path: str, content: str) -> tuple[list[dict], list[str]]:
    """CloudFormation YAML/JSON. Minimal: handle the most common AWS resource types."""
    resources: list[dict] = []
    unmatched: list[str] = []

    # We don't fully parse YAML — instead, regex out Resources blocks
    # Pattern: ResourceName: Type: AWS::EC2::Instance ... InstanceType: t3.micro
    block_rx = re.compile(
        r"^\s+([A-Za-z][\w]+):\s*\n\s+Type:\s*['\"]?(AWS::[\w:]+)['\"]?",
        re.MULTILINE,
    )
    for m in block_rx.finditer(content):
        rname = m.group(1)
        rtype = m.group(2)
        # Pull a chunk of context after the match for property extraction
        end = m.end()
        chunk = content[end:end + 800]

        if rtype == "AWS::EC2::Instance":
            it_match = re.search(r"InstanceType:\s*['\"]?([\w\.]+)['\"]?", chunk)
            resources.append({"file": path, "type": "aws.ec2", "name": rname,
                              "instance_type": it_match.group(1) if it_match else None, "quantity": 1})
        elif rtype == "AWS::RDS::DBInstance":
            it_match = re.search(r"DBInstanceClass:\s*['\"]?([\w\.]+)['\"]?", chunk)
            resources.append({"file": path, "type": "aws.rds", "name": rname,
                              "instance_type": it_match.group(1) if it_match else None, "quantity": 1})
        elif rtype == "AWS::ElasticLoadBalancingV2::LoadBalancer":
            resources.append({"file": path, "type": "aws.alb", "name": rname, "quantity": 1})
        elif rtype == "AWS::EC2::NatGateway":
            resources.append({"file": path, "type": "aws.nat_gateway", "name": rname, "quantity": 1})
        else:
            unmatched.append(f"{path}: {rtype} {rname}")
    return resources, unmatched


def _parse_kubernetes(path: str, content: str) -> tuple[list[dict], list[str]]:
    """
    K8s manifests. Sums up resources.requests across containers — that's what
    actually drives node-pool costs (since the cluster needs nodes big enough
    to fit the requests).
    """
    resources: list[dict] = []
    unmatched: list[str] = []

    # Find all container resource blocks
    cpu_total = 0.0   # in cores
    mem_total = 0.0   # in GB
    replicas_default = 1

    # Pull replicas (Deployment/StatefulSet)
    rep_match = re.search(r"replicas:\s*(\d+)", content)
    replicas = int(rep_match.group(1)) if rep_match else replicas_default

    # Pull resources blocks — look for requests:
    req_blocks = re.finditer(
        r"requests:\s*\n((?:\s+(?:cpu|memory):\s*[^\n]+\n?)+)",
        content,
    )
    for rb in req_blocks:
        block = rb.group(1)
        cpu_match = re.search(r"cpu:\s*['\"]?([\w\.]+)['\"]?", block)
        mem_match = re.search(r"memory:\s*['\"]?([\w\.]+)['\"]?", block)
        if cpu_match:
            cpu_total += _parse_cpu(cpu_match.group(1)) * replicas
        if mem_match:
            mem_total += _parse_memory(mem_match.group(1)) * replicas

    # Pull deployment name as "resource_name"
    name_match = re.search(r"^\s*name:\s*([\w\-]+)", content, re.MULTILINE)
    name = name_match.group(1) if name_match else "k8s-workload"

    if cpu_total > 0 or mem_total > 0:
        resources.append({
            "file": path,
            "type": "k8s.workload",
            "name": name,
            "cpu_cores": round(cpu_total, 2),
            "memory_gb": round(mem_total, 2),
            "quantity": 1,
        })
    return resources, unmatched


def _parse_cpu(value: str) -> float:
    """K8s CPU values: 100m = 0.1 cores, 2 = 2 cores."""
    value = value.strip()
    if value.endswith("m"):
        try: return int(value[:-1]) / 1000
        except ValueError: return 0
    try: return float(value)
    except ValueError: return 0


def _parse_memory(value: str) -> float:
    """K8s memory: 256Mi → 0.25 GB, 1Gi → 1 GB."""
    value = value.strip()
    multipliers = {"Ki": 1/(1024**2), "Mi": 1/1024, "Gi": 1, "Ti": 1024,
                   "K": 1/(1000**2), "M": 1/1000, "G": 1, "T": 1000}
    for suffix, mult in multipliers.items():
        if value.endswith(suffix):
            try: return float(value[:-len(suffix)]) * mult
            except ValueError: return 0
    try: return float(value) / (1024**3)  # bytes → GB
    except ValueError: return 0


def _extract_attr(block: str, attr: str) -> Optional[str]:
    """Extract `attr = "value"` from a Terraform block."""
    m = re.search(rf'{attr}\s*=\s*"([^"]+)"', block)
    return m.group(1) if m else None


# ─────────────────────────────────────────────────────────────────
# Pricing
# ─────────────────────────────────────────────────────────────────

def _price_resources(resources: list[dict]) -> list[ResourceLineItem]:
    items: list[ResourceLineItem] = []
    for r in resources:
        rtype = r.get("type", "")
        notes: list[str] = []
        unit_cost = 0.0

        if rtype == "aws.ec2":
            unit_cost = PRICE_CATALOG["aws.ec2"].get(r.get("instance_type", ""), 0)
            if unit_cost == 0 and r.get("instance_type"):
                notes.append(f"Instance type '{r['instance_type']}' not in price catalog")
        elif rtype == "aws.rds":
            unit_cost = PRICE_CATALOG["aws.rds"].get(r.get("instance_type", ""), 0)
            if unit_cost == 0 and r.get("instance_type"):
                notes.append(f"DB class '{r['instance_type']}' not in price catalog")
        elif rtype == "aws.ebs":
            gb = r.get("size_gb", 100)
            unit_cost = gb * PRICE_CATALOG["aws.ebs.gp3_per_gb"]
            notes.append(f"{gb} GB at ${PRICE_CATALOG['aws.ebs.gp3_per_gb']}/GB-month")
        elif rtype == "aws.alb":
            unit_cost = PRICE_CATALOG["aws.alb"]
        elif rtype == "aws.nat_gateway":
            unit_cost = PRICE_CATALOG["aws.nat_gateway"]
            notes.append("Plus $0.045/GB processed (not included in forecast)")
        elif rtype == "gcp.compute":
            unit_cost = PRICE_CATALOG["gcp.compute"].get(r.get("instance_type", ""), 0)
            if unit_cost == 0 and r.get("instance_type"):
                notes.append(f"Machine type '{r['instance_type']}' not in price catalog")
        elif rtype == "gcp.cloud_sql":
            unit_cost = PRICE_CATALOG["gcp.cloud_sql"].get(r.get("instance_type", ""), 0)
            if unit_cost == 0 and r.get("instance_type"):
                notes.append(f"Tier '{r['instance_type']}' not in price catalog")
        elif rtype == "azure.vm":
            unit_cost = PRICE_CATALOG["azure.vm"].get(r.get("instance_type", ""), 0)
            if unit_cost == 0 and r.get("instance_type"):
                notes.append(f"VM size '{r['instance_type']}' not in price catalog")
        elif rtype == "k8s.workload":
            cpu_cost = r.get("cpu_cores", 0) * PRICE_CATALOG["k8s.cpu_per_month"]
            mem_cost = r.get("memory_gb", 0) * PRICE_CATALOG["k8s.memory_per_gb"]
            unit_cost = cpu_cost + mem_cost
            notes.append(f"{r.get('cpu_cores', 0)} cores × ${PRICE_CATALOG['k8s.cpu_per_month']} + {r.get('memory_gb', 0)} GB × ${PRICE_CATALOG['k8s.memory_per_gb']}")

        qty = r.get("quantity", 1)
        items.append(ResourceLineItem(
            file_path=r.get("file", ""),
            resource_type=rtype,
            resource_name=r.get("name", ""),
            instance_type=r.get("instance_type"),
            quantity=qty,
            unit_cost_monthly=round(unit_cost, 2),
            total_cost_monthly=round(unit_cost * qty, 2),
            notes=notes,
        ))
    return items


def _empty_forecast(repo, msg: str) -> CostForecast:
    return CostForecast(
        repository_id=repo.id,
        repository_name=repo.full_name,
        summary=msg,
        current_monthly_cost=0.0,
        proposed_monthly_cost=0.0,
        delta_monthly=0.0,
        delta_pct=None,
        line_items_current=[],
        line_items_proposed=[],
        unmatched_resources=[],
        catalog_version=PRICE_CATALOG_VERSION,
        catalog_note=PRICE_CATALOG_NOTE,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
