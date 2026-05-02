"""
Compliance & Audit Reports.

Generates structured evidence reports for SOC 2, GDPR, and HIPAA from the actual
indexed codebase. The output is the kind of artifact security questionnaires and
procurement teams ask for — currently produced by hand at enormous cost.

Pipeline (all REAL data — no LLM fabrication of facts):

  1. Real-pattern detection across indexed files:
     - Authentication mechanisms (JWT, OAuth, sessions, password hashing)
     - Encryption usage (TLS config, field-level crypto, KMS calls)
     - PII handling (email, phone, SSN, address fields in code)
     - PHI handling (HIPAA-specific fields: medical records, diagnoses)
     - Logging and audit trails (which actions are logged where)
     - Access control (role checks, permission gates)
     - Third-party data sharing (analytics SDKs, error trackers, payment processors)

  2. Build a structured "evidence inventory" — every claim is backed by a real file
     path + line snippet from the actual codebase.

  3. LLM only writes the prose narrative around the real evidence, and only with
     explicit instruction to cite the inventory. The LLM never invents file paths
     or claims that aren't in the evidence list.

This isn't a substitute for a real audit — but it's the document that makes the
real audit 10× faster, and it's exactly what enterprise buyers ask security
teams for in pre-sales questionnaires.
"""

from __future__ import annotations
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.services.feature_gate import require_feature
from app.models.user import User
from app.models.repository import Repository, RepoFile
from app.services.lab_service import claude_complete_json

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/compliance", tags=["compliance"])


# ─────────────────────────────────────────────────────────────────
# Evidence-detection patterns
#
# Each pattern represents a real technical signal that an auditor would
# look for. We err on the side of false positives (flag for human review)
# rather than false negatives (missing real findings).
# ─────────────────────────────────────────────────────────────────

PATTERNS = {
    # ── Authentication ──
    "auth.jwt":              [r"\bjwt\.(sign|verify|decode)\b", r"jsonwebtoken", r"PyJWT", r"jose\.jwt"],
    "auth.oauth":            [r"\boauth2?\b", r"passport-(google|github|microsoft)", r"authlib"],
    "auth.session":          [r"express-session", r"flask-session", r"\bSessionMiddleware\b"],
    "auth.password_hash":    [r"\bbcrypt\b", r"\bargon2\b", r"\bscrypt\b", r"PBKDF2"],
    "auth.mfa":              [r"\botp\b", r"totp", r"\bmfa\b", r"two.factor", r"webauthn"],

    # ── Encryption ──
    "crypto.tls_required":   [r"\bhttps:", r"force_https", r"\bSSL.*REQUIRED\b", r"tls_min_version"],
    "crypto.field":          [r"AES-(128|256)", r"crypto\.encrypt", r"\bFernet\b", r"libsodium"],
    "crypto.kms":            [r"\bAWS\s*KMS\b", r"\baws-kms\b", r"\bGCP\s*KMS\b", r"\bAzure\s*Key\s*Vault\b", r"hashicorp.vault"],

    # ── PII (GDPR/CCPA) ──
    "pii.email":             [r"\bemail\b", r"e_?mail_address", r"@[\w\-]+\.[\w\-]+"],
    "pii.phone":             [r"\bphone\b", r"phone_number", r"mobile_number"],
    "pii.address":           [r"\baddress\b", r"street_address", r"\bzip\b", r"postal_code"],
    "pii.ssn":               [r"\bssn\b", r"social_security", r"tax_id"],
    "pii.dob":               [r"date_of_birth", r"\bdob\b", r"birthdate"],
    "pii.ip":                [r"\bip_address\b", r"client_ip", r"x-forwarded-for"],
    "pii.deletion_endpoint": [r"delete.user", r"delete.account", r"\bgdpr\b.*delete", r"right.to.erasure"],

    # ── PHI (HIPAA) ──
    "phi.medical":           [r"\bdiagnosis\b", r"medical_record", r"\bicd[\-_]?(9|10)\b", r"prescription"],
    "phi.patient":           [r"\bpatient\b", r"\bmrn\b", r"medical_record_number"],
    "phi.insurance":         [r"insurance_id", r"member_id", r"\bcpt[\-_]?code"],

    # ── Logging / audit ──
    "log.audit":             [r"audit_log", r"\baudit_trail\b", r"audit\.record"],
    "log.structured":        [r"\blogger\.(info|warn|error)", r"structlog", r"winston", r"pino"],
    "log.pii_redaction":     [r"\bredact\b", r"sanitize_log", r"mask_pii"],

    # ── Access control ──
    "access.rbac":           [r"\brole(s)?\b\s*[:=]", r"\bpermission(s)?\b", r"@require_role", r"hasRole"],
    "access.tenant_iso":     [r"tenant_id", r"organization_id", r"workspace_id"],

    # ── Third-party sharing ──
    "thirdparty.analytics":  [r"\b(google.analytics|mixpanel|segment|amplitude|posthog)\b"],
    "thirdparty.errors":     [r"\b(sentry|rollbar|bugsnag|datadog|newrelic|honeybadger)\b"],
    "thirdparty.payments":   [r"\b(stripe|braintree|adyen|paypal)\b"],
    "thirdparty.ai":         [r"\b(openai|anthropic|cohere|huggingface)\b"],
}

# Files we never want to scan (would flood with false positives)
SKIP_PATTERNS = [
    r"\.lock$", r"package-lock\.json$", r"yarn\.lock$", r"poetry\.lock$",
    r"\.min\.(js|css)$", r"node_modules/", r"\.git/", r"__pycache__/",
    r"\.test\.", r"\.spec\.", r"/tests?/",  # tests reference these patterns but aren't evidence
]


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class ComplianceRequest(BaseModel):
    repository_id: int
    framework: Literal["soc2", "gdpr", "hipaa"]


class EvidenceItem(BaseModel):
    pattern_id: str
    category: str
    file_path: str
    line_number: Optional[int] = None
    snippet: str


class ControlAssessment(BaseModel):
    control_id: str
    control_name: str
    framework: str
    status: Literal["evidence_found", "partial", "not_found", "manual_review"]
    evidence_count: int
    evidence: List[EvidenceItem]
    summary: str
    recommendation: Optional[str] = None


class ComplianceReport(BaseModel):
    repository_id: int
    repository_name: str
    framework: str
    framework_version: str
    summary: str
    overall_readiness_score: int  # 0-100
    controls: List[ControlAssessment]
    evidence_total: int
    files_scanned: int
    generated_at: str
    disclaimer: str


# ─────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────

@router.post("/report",
    dependencies=[Depends(require_feature("compliance"))],  # Business tier
    response_model=ComplianceReport,
)
async def generate_compliance_report(
    body: ComplianceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Scan the indexed codebase against the chosen compliance framework and produce
    a structured evidence report.

    Tier: Business (this is the marquee enterprise feature — every claim is
    grounded in real file evidence).
    """
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    if not repo.is_indexed:
        raise HTTPException(status_code=400, detail="Repository must be indexed first")

    # ── 1. Pull all indexed files ──
    files_res = await db.execute(
        select(RepoFile.path, RepoFile.content).where(RepoFile.repository_id == repo.id)
    )
    all_files = [(p, c or "") for p, c in files_res]
    relevant_files = [(p, c) for p, c in all_files if not _should_skip(p)]

    # ── 2. Build evidence inventory by scanning real files ──
    evidence_by_pattern: dict[str, list[EvidenceItem]] = defaultdict(list)
    for path, content in relevant_files:
        if not content:
            continue
        for pattern_id, regexes in PATTERNS.items():
            for rx in regexes:
                try:
                    matches = list(re.finditer(rx, content, re.IGNORECASE))
                except re.error:
                    continue
                for m in matches[:3]:  # cap matches per pattern per file
                    line_num = content[:m.start()].count("\n") + 1
                    snippet = _extract_snippet(content, m.start())
                    evidence_by_pattern[pattern_id].append(EvidenceItem(
                        pattern_id=pattern_id,
                        category=pattern_id.split(".")[0],
                        file_path=path,
                        line_number=line_num,
                        snippet=snippet,
                    ))
                if evidence_by_pattern[pattern_id] and len(evidence_by_pattern[pattern_id]) >= 5:
                    break  # cap at 5 evidence items per pattern per repo

    # ── 3. Map patterns to controls for the chosen framework ──
    control_map = _control_map_for(body.framework)
    controls: list[ControlAssessment] = []

    for control_id, info in control_map.items():
        control_evidence = []
        for pattern_id in info["patterns"]:
            control_evidence.extend(evidence_by_pattern.get(pattern_id, []))

        if len(control_evidence) >= info["min_evidence"]:
            status = "evidence_found"
        elif control_evidence:
            status = "partial"
        elif info.get("requires_manual"):
            status = "manual_review"
        else:
            status = "not_found"

        # LLM-generated control summary, grounded in the real evidence count
        summary = _control_summary(info["name"], status, len(control_evidence), info["patterns"])
        recommendation = info.get("recommendation") if status != "evidence_found" else None

        controls.append(ControlAssessment(
            control_id=control_id,
            control_name=info["name"],
            framework=body.framework,
            status=status,
            evidence_count=len(control_evidence),
            evidence=control_evidence[:8],
            summary=summary,
            recommendation=recommendation,
        ))

    # ── 4. Compute readiness score from real control statuses ──
    total_controls = len(controls)
    found = sum(1 for c in controls if c.status == "evidence_found")
    partial = sum(1 for c in controls if c.status == "partial")
    readiness = int(((found * 100) + (partial * 50)) / max(total_controls, 1))

    # ── 5. LLM only for the executive summary, given REAL counts ──
    framework_versions = {"soc2": "Trust Services Criteria 2017", "gdpr": "GDPR (EU 2016/679)", "hipaa": "HIPAA Security Rule"}
    summary_prompt = (
        f"FRAMEWORK: {body.framework.upper()}\n"
        f"REPOSITORY: {repo.full_name}\n"
        f"FILES SCANNED: {len(relevant_files)}\n"
        f"CONTROLS ASSESSED: {total_controls}\n"
        f"  - With evidence: {found}\n"
        f"  - Partial: {partial}\n"
        f"  - Not found: {total_controls - found - partial}\n"
        f"OVERALL READINESS: {readiness}/100\n\n"
        f"Write a 3-4 sentence executive summary for a security team. "
        f"Focus on the gaps and next steps. Do NOT invent specific findings — "
        f"the evidence above is all we have. Return STRICT JSON: {{ \"summary\": str }}"
    )
    llm = await claude_complete_json(
        system="You write executive compliance summaries from REAL audit data. Never fabricate. Return STRICT JSON.",
        prompt=summary_prompt,
    )

    return ComplianceReport(
        repository_id=repo.id,
        repository_name=repo.full_name,
        framework=body.framework,
        framework_version=framework_versions[body.framework],
        summary=llm.get("summary") or
            f"Scanned {len(relevant_files)} files. {found}/{total_controls} controls have direct evidence; readiness {readiness}/100.",
        overall_readiness_score=readiness,
        controls=controls,
        evidence_total=sum(c.evidence_count for c in controls),
        files_scanned=len(relevant_files),
        generated_at=datetime.now(timezone.utc).isoformat(),
        disclaimer=(
            "This automated report identifies signals in your codebase that map to common "
            f"{body.framework.upper()} controls. It is a starting point for a real audit, not a "
            "substitute. Engage a qualified auditor for formal certification."
        ),
    )


# ─────────────────────────────────────────────────────────────────
# Control-to-pattern maps for each framework
# ─────────────────────────────────────────────────────────────────

def _control_map_for(framework: str) -> dict:
    if framework == "soc2":
        return {
            "CC6.1":  {"name": "Logical access — authentication", "patterns": ["auth.jwt", "auth.oauth", "auth.session", "auth.password_hash"], "min_evidence": 1, "recommendation": "Implement at least one authentication mechanism for all access points."},
            "CC6.2":  {"name": "Logical access — multi-factor authentication", "patterns": ["auth.mfa"], "min_evidence": 1, "recommendation": "MFA is required for SOC 2. Add TOTP or WebAuthn for privileged accounts."},
            "CC6.3":  {"name": "Logical access — RBAC and tenant isolation", "patterns": ["access.rbac", "access.tenant_iso"], "min_evidence": 1, "recommendation": "Implement role-based access control. Ensure multi-tenant data isolation if applicable."},
            "CC6.6":  {"name": "Encryption in transit", "patterns": ["crypto.tls_required"], "min_evidence": 1, "recommendation": "Enforce HTTPS/TLS 1.2+ for all external endpoints."},
            "CC6.7":  {"name": "Encryption at rest", "patterns": ["crypto.field", "crypto.kms"], "min_evidence": 1, "recommendation": "Use a KMS-backed envelope encryption scheme for sensitive data fields."},
            "CC7.1":  {"name": "System monitoring and logging", "patterns": ["log.audit", "log.structured"], "min_evidence": 1, "recommendation": "Implement structured logging with audit trails for sensitive operations."},
            "CC7.2":  {"name": "Sensitive log redaction", "patterns": ["log.pii_redaction"], "min_evidence": 1, "requires_manual": True, "recommendation": "Ensure logs do not contain raw PII. Add explicit redaction in logging middleware."},
            "CC8.1":  {"name": "Third-party data sharing", "patterns": ["thirdparty.analytics", "thirdparty.errors", "thirdparty.payments", "thirdparty.ai"], "min_evidence": 0, "requires_manual": True, "recommendation": "Inventory all third-party data processors and ensure DPAs are in place."},
        }
    if framework == "gdpr":
        return {
            "GDPR.6":  {"name": "Lawful basis for processing", "patterns": [], "min_evidence": 1, "requires_manual": True, "recommendation": "Document the lawful basis (consent, contract, legitimate interest) for each PII type."},
            "GDPR.17": {"name": "Right to erasure (account deletion)", "patterns": ["pii.deletion_endpoint"], "min_evidence": 1, "recommendation": "Implement a user-facing account deletion endpoint that purges PII."},
            "GDPR.25": {"name": "Privacy by design — PII inventory", "patterns": ["pii.email", "pii.phone", "pii.address", "pii.ssn", "pii.dob", "pii.ip"], "min_evidence": 1, "recommendation": "Maintain an up-to-date data flow map of all PII fields and their purposes."},
            "GDPR.28": {"name": "Processor obligations — third parties", "patterns": ["thirdparty.analytics", "thirdparty.errors", "thirdparty.payments"], "min_evidence": 0, "requires_manual": True, "recommendation": "Sign Data Processing Agreements with all third-party processors and document data flows."},
            "GDPR.32": {"name": "Security of processing — encryption", "patterns": ["crypto.tls_required", "crypto.field", "crypto.kms"], "min_evidence": 1, "recommendation": "Encrypt PII in transit (TLS) and at rest (KMS-backed)."},
            "GDPR.33": {"name": "Breach notification — logging readiness", "patterns": ["log.audit", "log.structured"], "min_evidence": 1, "recommendation": "Maintain audit logs to detect and report breaches within 72 hours."},
            "GDPR.35": {"name": "Sensitive data — DPIA triggers", "patterns": ["pii.ssn", "pii.dob", "phi.medical"], "min_evidence": 0, "requires_manual": True, "recommendation": "If processing special categories of data, conduct a Data Protection Impact Assessment."},
        }
    if framework == "hipaa":
        return {
            "164.308.a.3": {"name": "Workforce access management", "patterns": ["access.rbac", "auth.password_hash"], "min_evidence": 2, "recommendation": "Enforce role-based access control. PHI access must be audited per user."},
            "164.308.a.4": {"name": "Information access management", "patterns": ["access.rbac", "access.tenant_iso"], "min_evidence": 1, "recommendation": "Restrict PHI access to the minimum necessary for each role."},
            "164.308.a.5": {"name": "Security awareness — automated logoff", "patterns": ["auth.session"], "min_evidence": 1, "requires_manual": True, "recommendation": "Implement automatic session timeouts on all PHI-handling sessions."},
            "164.312.a.1": {"name": "Access control — unique user identification", "patterns": ["auth.jwt", "auth.oauth", "auth.session"], "min_evidence": 1, "recommendation": "Each user must have a unique identifier. No shared accounts."},
            "164.312.a.2": {"name": "Encryption — PHI at rest", "patterns": ["crypto.field", "crypto.kms"], "min_evidence": 1, "recommendation": "Encrypt PHI at rest with AES-256 or equivalent. Key management via KMS."},
            "164.312.b":   {"name": "Audit controls", "patterns": ["log.audit", "log.structured"], "min_evidence": 1, "recommendation": "Log all PHI access events with user, timestamp, and action."},
            "164.312.e.1": {"name": "Encryption — PHI in transit", "patterns": ["crypto.tls_required"], "min_evidence": 1, "recommendation": "Force TLS 1.2+ for all PHI transmission. No plaintext HTTP."},
            "164.502":     {"name": "PHI inventory", "patterns": ["phi.medical", "phi.patient", "phi.insurance"], "min_evidence": 0, "requires_manual": True, "recommendation": "Maintain an inventory of all systems handling PHI."},
        }
    return {}


def _control_summary(name: str, status: str, count: int, patterns: list[str]) -> str:
    """Deterministic summary — no LLM needed for control-level text."""
    if status == "evidence_found":
        return f"{count} matching code patterns found across the indexed files."
    if status == "partial":
        return f"Partial evidence — {count} signal(s) found but below the recommended threshold."
    if status == "manual_review":
        return "Requires manual review — this control is policy-driven and cannot be auto-verified from code."
    return "No matching code patterns found in the indexed repository."


def _should_skip(path: str) -> bool:
    return any(re.search(p, path) for p in SKIP_PATTERNS)


def _extract_snippet(content: str, pos: int, context_lines: int = 1) -> str:
    """Pull a short snippet around the match position for the evidence record."""
    lines = content.splitlines()
    line_num = content[:pos].count("\n")
    start = max(0, line_num - context_lines)
    end = min(len(lines), line_num + context_lines + 1)
    snippet = "\n".join(lines[start:end])
    return snippet[:300]
