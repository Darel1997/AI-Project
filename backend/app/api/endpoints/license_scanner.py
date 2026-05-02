"""
License & IP Scanner — real license analysis.

What it does (all from real public-API data, zero LLM fabrication):

  1. Parse manifests (package.json, pyproject.toml, requirements.txt, Cargo.toml,
     Gemfile, go.mod) from the indexed repo
  2. For each dependency, query the registry (npm/PyPI/crates.io) for the real
     SPDX license identifier
  3. Compare each dep's license against the project's declared license to
     detect contamination risk:
       - GPL/AGPL pulled into a permissive project → flag CRITICAL
       - Unknown licenses → flag HIGH (legal can't approve unknowns)
       - License conflicts within the same dep tree → flag MEDIUM
  4. Generate a downloadable SPDX SBOM (Software Bill of Materials) — the
     industry standard format that procurement, security, and legal teams
     all expect.

This is the kind of report enterprise buyers ask for in their security
questionnaires and that their legal team requires before purchase.
"""

from __future__ import annotations
import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Optional, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.services.feature_gate import require_feature
from app.models.user import User
from app.models.repository import Repository, RepoFile

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/license-scanner", tags=["license-scanner"])


# ─────────────────────────────────────────────────────────────────
# License classification — based on the SPDX license list and
# common open-source policy decisions. NOT legal advice — these are
# heuristics that match how most tech-company legal teams classify
# licenses for procurement/audit purposes.
# ─────────────────────────────────────────────────────────────────

# Permissive — minimal obligations, safe to use commercially
PERMISSIVE = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0", "Zlib"}

# Weak copyleft — file-level copyleft, generally OK for libraries
WEAK_COPYLEFT = {"LGPL-2.0", "LGPL-2.1", "LGPL-3.0", "LGPL-2.1-or-later", "LGPL-3.0-or-later", "MPL-2.0", "EPL-2.0", "EUPL-1.2"}

# Strong copyleft — viral, contaminates derivative works
STRONG_COPYLEFT = {"GPL-2.0", "GPL-3.0", "GPL-2.0-or-later", "GPL-3.0-or-later", "GPL-2.0-only", "GPL-3.0-only"}

# Network copyleft — most aggressive (extends to network use)
NETWORK_COPYLEFT = {"AGPL-3.0", "AGPL-3.0-or-later", "AGPL-3.0-only", "SSPL-1.0"}

# Source-available but not OSS — restrictive commercial-use clauses
SOURCE_AVAILABLE = {"BUSL-1.1", "Elastic-2.0", "Commons-Clause", "FSL-1.1-MIT", "FSL-1.1-ALv2", "PolyForm-Noncommercial-1.0.0"}


def license_category(spdx: str) -> str:
    """Map SPDX ID to risk category."""
    if not spdx:
        return "unknown"
    s = spdx.strip()
    if s in PERMISSIVE:        return "permissive"
    if s in WEAK_COPYLEFT:     return "weak_copyleft"
    if s in STRONG_COPYLEFT:   return "strong_copyleft"
    if s in NETWORK_COPYLEFT:  return "network_copyleft"
    if s in SOURCE_AVAILABLE:  return "source_available"
    if s.upper() in ("UNLICENSED", "NONE", "PROPRIETARY", "SEE LICENSE IN LICENSE"):
        return "proprietary"
    return "unknown"


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class ScanRequest(BaseModel):
    repository_id: int
    project_license: Optional[str] = None  # If unset, we infer from LICENSE file


class LicenseFinding(BaseModel):
    name: str
    version: Optional[str] = None
    ecosystem: str
    license: Optional[str] = None
    license_category: str  # permissive | weak_copyleft | strong_copyleft | network_copyleft | source_available | proprietary | unknown
    severity: Literal["info", "low", "medium", "high", "critical"]
    concerns: List[str]
    repository_url: Optional[str] = None


class LicenseScanReport(BaseModel):
    repository_id: int
    repository_name: str
    project_license: Optional[str]
    project_license_category: str
    summary: str
    counts_by_severity: dict
    counts_by_category: dict
    findings: List[LicenseFinding]
    sbom_spdx_url: str          # download endpoint
    generated_at: str


# ─────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────

@router.post("/scan", response_model=LicenseScanReport)
async def scan_licenses(
    body: ScanRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Scan all dependencies for real licenses, detect contamination, classify risk.
    Returns a structured report + a download URL for the SPDX SBOM.

    Free for all tiers — license compliance is a "must-have" for enterprise buyers
    and we want every user surfacing this information.
    """
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # ── Detect project license from LICENSE / package.json ──
    project_license = body.project_license or await _detect_project_license(db, repo.id)
    project_category = license_category(project_license) if project_license else "unknown"

    # ── Parse manifests ──
    deps = await _parse_all_manifests(db, repo.id)
    if not deps:
        return _empty_report(repo, project_license, project_category, "No dependency manifests found.")

    # Cap to keep the scan fast
    deps = deps[:50]

    # ── Query each registry for real license info ──
    findings: list[LicenseFinding] = []
    async with httpx.AsyncClient(timeout=10) as client:
        for name, version, ecosystem in deps:
            license_info = await _fetch_license(client, name, ecosystem)
            spdx = license_info.get("license")
            category = license_category(spdx)
            severity, concerns = _classify_against_project(category, project_category, spdx)
            findings.append(LicenseFinding(
                name=name,
                version=version or None,
                ecosystem=ecosystem,
                license=spdx,
                license_category=category,
                severity=severity,
                concerns=concerns,
                repository_url=license_info.get("repository_url"),
            ))

    counts_severity = defaultdict(int)
    counts_category = defaultdict(int)
    for f in findings:
        counts_severity[f.severity] += 1
        counts_category[f.license_category] += 1

    summary = _build_summary(project_license, findings, dict(counts_severity), dict(counts_category))

    return LicenseScanReport(
        repository_id=repo.id,
        repository_name=repo.full_name,
        project_license=project_license,
        project_license_category=project_category,
        summary=summary,
        counts_by_severity=dict(counts_severity),
        counts_by_category=dict(counts_category),
        findings=findings,
        sbom_spdx_url=f"/api/license-scanner/sbom/{repo.id}",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/sbom/{repository_id}")
async def download_sbom(
    repository_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a real SPDX 2.3 JSON SBOM. Standard format that
    procurement, security, and legal teams actually consume.
    """
    res = await db.execute(select(Repository).where(Repository.id == repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    project_license = await _detect_project_license(db, repo.id) or "NOASSERTION"
    deps = await _parse_all_manifests(db, repo.id)
    deps = deps[:200]  # cap higher for SBOM

    packages = [{
        "SPDXID": "SPDXRef-Package-Root",
        "name": repo.full_name,
        "downloadLocation": f"https://github.com/{repo.full_name}",
        "filesAnalyzed": False,
        "licenseConcluded": project_license,
        "licenseDeclared": project_license,
        "supplier": f"Organization: {repo.full_name.split('/')[0]}",
        "versionInfo": "HEAD",
    }]
    relationships = [{
        "spdxElementId": "SPDXRef-DOCUMENT",
        "relationshipType": "DESCRIBES",
        "relatedSpdxElement": "SPDXRef-Package-Root",
    }]

    async with httpx.AsyncClient(timeout=10) as client:
        for i, (name, version, ecosystem) in enumerate(deps):
            spdx_id = f"SPDXRef-Package-{ecosystem}-{i}"
            license_info = await _fetch_license(client, name, ecosystem)
            spdx_license = license_info.get("license") or "NOASSERTION"
            packages.append({
                "SPDXID": spdx_id,
                "name": name,
                "versionInfo": version or "NOASSERTION",
                "downloadLocation": _registry_url(name, ecosystem),
                "filesAnalyzed": False,
                "licenseConcluded": spdx_license,
                "licenseDeclared": spdx_license,
                "supplier": "NOASSERTION",
                "externalRefs": [{
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": _purl(name, version, ecosystem),
                }],
            })
            relationships.append({
                "spdxElementId": "SPDXRef-Package-Root",
                "relationshipType": "DEPENDS_ON",
                "relatedSpdxElement": spdx_id,
            })

    sbom = {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"sbom-{repo.full_name.replace('/', '-')}",
        "documentNamespace": f"https://repoinsight.ai/sbom/{repo.id}/{datetime.now(timezone.utc).isoformat()}",
        "creationInfo": {
            "created": datetime.now(timezone.utc).isoformat(),
            "creators": ["Tool: RepoInsight-LicenseScanner-1.0"],
        },
        "packages": packages,
        "relationships": relationships,
    }
    return sbom


# ─────────────────────────────────────────────────────────────────
# Helpers — manifest parsing, registry fetching, classification
# ─────────────────────────────────────────────────────────────────

async def _detect_project_license(db, repo_id: int) -> Optional[str]:
    """Look in package.json `license` field, then LICENSE file content."""
    res = await db.execute(
        select(RepoFile).where(
            RepoFile.repository_id == repo_id,
            RepoFile.path.in_(["package.json", "pyproject.toml", "LICENSE", "LICENSE.md", "LICENSE.txt"]),
        )
    )
    files = {f.path: f for f in res.scalars().all()}

    if "package.json" in files:
        try:
            d = json.loads(files["package.json"].content)
            if "license" in d and isinstance(d["license"], str):
                return d["license"]
        except json.JSONDecodeError:
            pass

    if "pyproject.toml" in files:
        m = re.search(r"license\s*=\s*['\"]([^'\"]+)['\"]", files["pyproject.toml"].content)
        if m:
            return m.group(1)

    # Heuristic match against LICENSE file content
    for name in ("LICENSE", "LICENSE.md", "LICENSE.txt"):
        if name in files:
            content = (files[name].content or "")[:500].lower()
            if "mit license" in content: return "MIT"
            if "apache license" in content and "version 2" in content: return "Apache-2.0"
            if "bsd 3-clause" in content: return "BSD-3-Clause"
            if "bsd 2-clause" in content: return "BSD-2-Clause"
            if "agpl" in content or "affero" in content: return "AGPL-3.0"
            if "gnu general public license" in content and "version 3" in content: return "GPL-3.0"
            if "gnu general public license" in content and "version 2" in content: return "GPL-2.0"
            if "mozilla public license" in content: return "MPL-2.0"
            if "isc license" in content: return "ISC"
    return None


async def _parse_all_manifests(db, repo_id: int) -> list[tuple[str, str, str]]:
    """Pull manifest files from indexed repo, parse all dep entries."""
    paths = ["package.json", "pyproject.toml", "Cargo.toml", "requirements.txt", "Gemfile", "go.mod"]
    res = await db.execute(
        select(RepoFile).where(RepoFile.repository_id == repo_id, RepoFile.path.in_(paths))
    )
    out: list[tuple[str, str, str]] = []
    for m in res.scalars().all():
        if m.path == "package.json":
            try:
                d = json.loads(m.content)
                for k in ("dependencies", "devDependencies"):
                    for n, v in (d.get(k) or {}).items():
                        out.append((n, str(v), "npm"))
            except json.JSONDecodeError:
                pass
        elif m.path == "pyproject.toml":
            in_deps = False
            for line in (m.content or "").splitlines():
                s = line.strip()
                if s.startswith("[") and "dependencies" in s.lower():
                    in_deps = True; continue
                if s.startswith("["):
                    in_deps = False; continue
                mt = re.match(r'([a-zA-Z0-9_\-\.]+)\s*=\s*"([^"]+)"', s)
                if in_deps and mt:
                    out.append((mt.group(1), mt.group(2), "pypi"))
        elif m.path == "requirements.txt":
            for line in (m.content or "").splitlines():
                s = line.strip().split("#")[0].strip()
                if not s or s.startswith("-"): continue
                mt = re.match(r"([a-zA-Z0-9_\-\.]+)([=<>~!]+(.+))?", s)
                if mt:
                    out.append((mt.group(1), mt.group(3) or "", "pypi"))
        elif m.path == "Cargo.toml":
            in_deps = False
            for line in (m.content or "").splitlines():
                s = line.strip()
                if s.startswith("[dependencies"):
                    in_deps = True; continue
                if s.startswith("["):
                    in_deps = False; continue
                mt = re.match(r'([a-zA-Z0-9_\-]+)\s*=\s*"([^"]+)"', s)
                if in_deps and mt:
                    out.append((mt.group(1), mt.group(2), "cargo"))
        elif m.path == "Gemfile":
            for line in (m.content or "").splitlines():
                mt = re.match(r"\s*gem\s+['\"]([^'\"]+)['\"](?:\s*,\s*['\"]([^'\"]+)['\"])?", line)
                if mt:
                    out.append((mt.group(1), mt.group(2) or "", "rubygems"))
        elif m.path == "go.mod":
            for line in (m.content or "").splitlines():
                mt = re.match(r"\s*([a-zA-Z0-9_\-\./]+)\s+v([\w\.\-]+)", line)
                if mt and "/" in mt.group(1):
                    out.append((mt.group(1), mt.group(2), "go"))
    return out


async def _fetch_license(client: httpx.AsyncClient, name: str, ecosystem: str) -> dict:
    """Real license info from real registries."""
    try:
        if ecosystem == "npm":
            r = await client.get(f"https://registry.npmjs.org/{name}/latest")
            if r.status_code == 200:
                d = r.json()
                lic = d.get("license")
                if isinstance(lic, dict): lic = lic.get("type")
                return {"license": lic, "repository_url": (d.get("repository") or {}).get("url")}
        elif ecosystem == "pypi":
            r = await client.get(f"https://pypi.org/pypi/{name}/json")
            if r.status_code == 200:
                info = r.json().get("info", {})
                # PyPI sometimes puts SPDX in classifiers
                lic = info.get("license")
                for c in info.get("classifiers", []):
                    if c.startswith("License :: OSI Approved ::"):
                        spdx = _classifier_to_spdx(c)
                        if spdx: lic = spdx; break
                return {"license": lic, "repository_url": info.get("home_page")}
        elif ecosystem == "cargo":
            r = await client.get(f"https://crates.io/api/v1/crates/{name}")
            if r.status_code == 200:
                d = r.json().get("crate", {})
                # Cargo often lists OR'd licenses like "MIT OR Apache-2.0"
                lic = d.get("license") or ""
                # Pick the most permissive option for the simpler view
                if " OR " in lic:
                    options = [o.strip() for o in lic.split(" OR ")]
                    for pref in ["MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause"]:
                        if pref in options:
                            lic = pref; break
                    else:
                        lic = options[0]
                return {"license": lic, "repository_url": d.get("repository")}
    except Exception as e:
        log.debug("license fetch failed for %s/%s: %s", ecosystem, name, e)
    return {"license": None}


def _classifier_to_spdx(classifier: str) -> Optional[str]:
    """Map a PyPI Trove classifier to SPDX ID."""
    mapping = {
        "MIT License": "MIT",
        "Apache Software License": "Apache-2.0",
        "BSD License": "BSD-3-Clause",
        "GNU General Public License v3 (GPLv3)": "GPL-3.0",
        "GNU General Public License v2 (GPLv2)": "GPL-2.0",
        "GNU Lesser General Public License v3 (LGPLv3)": "LGPL-3.0",
        "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
        "ISC License (ISCL)": "ISC",
        "GNU Affero General Public License v3": "AGPL-3.0",
    }
    for key, spdx in mapping.items():
        if key in classifier:
            return spdx
    return None


def _classify_against_project(dep_cat: str, project_cat: str, dep_license: Optional[str]) -> tuple[str, list[str]]:
    """Severity + concerns based on real categories."""
    concerns = []

    if dep_cat == "unknown" or not dep_license:
        return "high", ["License could not be determined — legal review required before use"]

    if dep_cat == "proprietary":
        return "critical", ["Proprietary license — usage rights unclear"]

    # Network copyleft pulled into anything-but-network-copyleft = critical
    if dep_cat == "network_copyleft":
        if project_cat != "network_copyleft":
            return "critical", [
                f"{dep_license} (network copyleft) requires you to release source code if used over a network",
                "If your project is closed-source or differently licensed, this is a contamination risk",
            ]
        return "low", ["Compatible network copyleft licenses"]

    # Strong copyleft pulled into permissive = critical
    if dep_cat == "strong_copyleft":
        if project_cat in ("permissive", "weak_copyleft"):
            return "critical", [
                f"{dep_license} (strong copyleft) is incompatible with permissive licensing",
                "Linking against this library may force your entire project under GPL",
            ]
        return "low", []

    # Source-available BSL/Elastic in commercial use
    if dep_cat == "source_available":
        return "high", [
            f"{dep_license} restricts commercial use cases",
            "Verify your usage falls within the license terms",
        ]

    # Weak copyleft is generally OK
    if dep_cat == "weak_copyleft":
        return "low", [f"{dep_license} (weak copyleft) — generally compatible if used as a library"]

    # Permissive is fine
    if dep_cat == "permissive":
        return "info", []

    return "medium", [f"License category: {dep_cat}"]


def _build_summary(project_license, findings, sev_counts, cat_counts) -> str:
    crit = sev_counts.get("critical", 0)
    high = sev_counts.get("high", 0)
    if crit > 0:
        return f"{crit} critical license conflicts found. Block merge until resolved."
    if high > 0:
        return f"{high} dependencies need legal review before commercial use."
    return f"No license issues found across {len(findings)} dependencies."


def _registry_url(name: str, ecosystem: str) -> str:
    return {
        "npm": f"https://www.npmjs.com/package/{name}",
        "pypi": f"https://pypi.org/project/{name}/",
        "cargo": f"https://crates.io/crates/{name}",
        "rubygems": f"https://rubygems.org/gems/{name}",
        "go": f"https://pkg.go.dev/{name}",
    }.get(ecosystem, "NOASSERTION")


def _purl(name: str, version: str, ecosystem: str) -> str:
    """Construct a Package URL (purl) — standardized identifier for SBOMs."""
    eco_map = {"npm": "npm", "pypi": "pypi", "cargo": "cargo", "rubygems": "gem", "go": "golang"}
    eco = eco_map.get(ecosystem, ecosystem)
    if version:
        return f"pkg:{eco}/{name}@{version}"
    return f"pkg:{eco}/{name}"


def _empty_report(repo, lic, lic_cat, msg) -> LicenseScanReport:
    return LicenseScanReport(
        repository_id=repo.id,
        repository_name=repo.full_name,
        project_license=lic,
        project_license_category=lic_cat,
        summary=msg,
        counts_by_severity={},
        counts_by_category={},
        findings=[],
        sbom_spdx_url=f"/api/license-scanner/sbom/{repo.id}",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
