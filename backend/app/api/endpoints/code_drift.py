"""
Code Drift Detection.

Engineers care about consistency: "everyone uses async/await here but this PR
introduces .then chains", "we always use logger.info() but this code uses print()",
"all our API handlers have try/except blocks except this new one."

Detection pipeline (all REAL signal, zero LLM fabrication):

  1. Build a pattern fingerprint from indexed files in the same scope as the
     changed file (e.g. all files in src/api/, or files of the same extension):
       - Convention dominance: which patterns are used by ≥80% of similar files
       - Anti-patterns: things <5% of similar files do
       - Style fingerprints: indent style, quote style, import style

  2. For each changed file in a PR (or arbitrary file), check whether it
     conforms to the dominant patterns of its peer set.

  3. Output structured violations with:
       - Pattern name (e.g. "async-error-handling")
       - Peer dominance % (how many similar files do this)
       - File evidence (real paths from the codebase showing the convention)
       - Severity based on dominance gap

  4. LLM only used to write the human explanation per violation,
     given the real evidence — and instructed never to invent file paths.

Designed to plug into the AI PR Reviewer next round, so drift findings appear
as inline comments on PRs alongside blast radius.
"""

from __future__ import annotations
import logging
import re
from collections import Counter, defaultdict
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
router = APIRouter(prefix="/api/code-drift", tags=["code-drift"])


# ─────────────────────────────────────────────────────────────────
# Pattern detectors
#
# Each detector returns True/False per file. We compute the dominance
# of each pattern across peer files, then check the target file against it.
# ─────────────────────────────────────────────────────────────────

PATTERNS = {
    # ── Async / concurrency style ──
    "async_await":        lambda c: bool(re.search(r"\basync\s+(?:def|function)\b|\bawait\s+", c)),
    "promise_chains":     lambda c: bool(re.search(r"\.then\s*\(.*?\)\s*\.then\s*\(", c, re.DOTALL)),
    "callbacks":          lambda c: bool(re.search(r"function\s*\(\s*(?:err|error)\s*,", c)),

    # ── Error handling ──
    "try_except":         lambda c: bool(re.search(r"\b(?:try\s*:|try\s*\{)", c)),
    "logger_for_errors":  lambda c: bool(re.search(r"logger?\.(error|warning|exception|warn)\b", c)),
    "print_for_errors":   lambda c: bool(re.search(r"\bprint\s*\(.*?(?:err|error|exception|fail)", c, re.IGNORECASE)),
    "console_for_errors": lambda c: bool(re.search(r"console\.(error|warn)\b", c)),

    # ── Logging discipline ──
    "uses_logger":        lambda c: bool(re.search(r"\b(?:logger|log|logging)\.(info|debug|warning|error)\b", c)),
    "uses_print":         lambda c: bool(re.search(r"\bprint\s*\(", c)),
    "uses_console_log":   lambda c: bool(re.search(r"\bconsole\.log\b", c)),

    # ── Type annotations (Python/TS) ──
    "type_hints_py":      lambda c: bool(re.search(r"def\s+\w+\s*\([^)]*:\s*\w+|\->\s*\w+\s*:", c)),
    "no_type_hints_py":   lambda c: bool(re.search(r"def\s+\w+\s*\([^):]*\)\s*:", c)) and not bool(re.search(r"def\s+\w+\s*\([^)]*:\s*\w+", c)),
    "ts_explicit_types":  lambda c: bool(re.search(r":\s*(?:string|number|boolean|Promise<|Array<|Record<)", c)),
    "ts_any":             lambda c: bool(re.search(r":\s*any\b", c)),

    # ── Code organization ──
    "default_export":     lambda c: bool(re.search(r"^\s*export\s+default\b", c, re.MULTILINE)),
    "named_exports_only": lambda c: bool(re.search(r"^\s*export\s+(?:const|function|class)\b", c, re.MULTILINE)) and not bool(re.search(r"^\s*export\s+default\b", c, re.MULTILINE)),
    "barrel_imports":     lambda c: bool(re.search(r"from\s+['\"][^'\"]*/index['\"]", c)),

    # ── String style ──
    "double_quotes":      lambda c: c.count('"') > c.count("'") * 2,
    "single_quotes":      lambda c: c.count("'") > c.count('"') * 2,
    "template_literals":  lambda c: bool(re.search(r"`[^`]*\$\{", c)),

    # ── Indent style ──
    "tabs_indent":        lambda c: any(line.startswith("\t") for line in c.splitlines()[:50]),
    "spaces_indent":      lambda c: any(re.match(r"^    \S", line) for line in c.splitlines()[:50]),

    # ── Documentation ──
    "has_docstrings":     lambda c: bool(re.search(r'def\s+\w+[^:]*:\s*\n\s*"""', c)),
    "has_jsdoc":          lambda c: bool(re.search(r"/\*\*[\s\S]*?\*/", c)),

    # ── Testing patterns ──
    "uses_pytest":        lambda c: bool(re.search(r"\bdef\s+test_\w+\s*\(|@pytest\.", c)),
    "uses_unittest":      lambda c: bool(re.search(r"class\s+\w+\(.*?TestCase\)", c)),
    "uses_jest":          lambda c: bool(re.search(r"\b(?:describe|it|test|expect)\s*\(", c)),
}


# Patterns that conflict — only one of each pair should be considered as a "norm"
PATTERN_GROUPS = [
    {"async_await", "promise_chains", "callbacks"},
    {"uses_logger", "uses_print", "uses_console_log"},
    {"type_hints_py", "no_type_hints_py"},
    {"ts_explicit_types", "ts_any"},
    {"default_export", "named_exports_only"},
    {"double_quotes", "single_quotes"},
    {"tabs_indent", "spaces_indent"},
    {"uses_pytest", "uses_unittest"},
]


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class DriftCheckRequest(BaseModel):
    repository_id: int
    file_paths: List[str] = Field(..., description="Files to analyze for drift against the rest of the repo")
    file_contents: Optional[dict] = Field(None, description="Optional override content (e.g. PR diff). If not provided, uses indexed content.")


class DriftViolation(BaseModel):
    file_path: str
    pattern_id: str
    pattern_name: str
    description: str
    severity: Literal["info", "low", "medium", "high"]
    peer_dominance_pct: float
    peer_examples: List[str]      # Real file paths showing the convention
    suggested_fix: Optional[str] = None


class DriftReport(BaseModel):
    repository_id: int
    repository_name: str
    summary: str
    files_analyzed: int
    peer_set_size: int
    violations: List[DriftViolation]
    drift_score: int  # 0-100, higher = more drift
    generated_at: str


# ─────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────

@router.post("/check",
    dependencies=[Depends(require_feature("code_drift"))],
    response_model=DriftReport,
)
async def check_drift(
    body: DriftCheckRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Compare the target files against the patterns established in their peer set.
    """
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    if not repo.is_indexed:
        raise HTTPException(status_code=400, detail="Repository must be indexed first")

    # ── 1. Pull the entire indexed corpus once ──
    files_res = await db.execute(
        select(RepoFile.path, RepoFile.content).where(RepoFile.repository_id == body.repository_id)
    )
    all_files = {p: (c or "") for p, c in files_res}

    if not all_files:
        return _empty_report(repo, "No indexed files to compare against.")

    # ── 2. For each target file, compute drift against its peer set ──
    violations: list[DriftViolation] = []
    target_set: set[str] = set(body.file_paths)
    peer_set_size = 0  # take from the largest peer set we encounter

    for target_path in body.file_paths:
        # Use override content if supplied (for PR diffs), else the indexed content
        target_content = (body.file_contents or {}).get(target_path) or all_files.get(target_path, "")
        if not target_content:
            continue

        peers = _peer_set(target_path, all_files, exclude=target_set)
        if len(peers) < 5:
            # Too few peers to establish a convention — skip silently
            continue
        peer_set_size = max(peer_set_size, len(peers))

        # Compute pattern dominance across the peer set
        dominance = _compute_dominance(peers)

        # Check the target file against each dominant pattern
        for pattern_id, dom_pct in dominance.items():
            target_has = PATTERNS[pattern_id](target_content)

            # Convention violation: peers strongly use it (≥80%) but target doesn't
            if dom_pct >= 80 and not target_has:
                violations.append(_build_violation(
                    target_path, pattern_id, dom_pct, peers, dominance, missing=True,
                ))

            # Anti-pattern: peers rarely use it (≤5%) but target does
            elif dom_pct <= 5 and target_has and dom_pct < 100:
                # Make sure this isn't actually the dominant pattern in a conflict group
                group = next((g for g in PATTERN_GROUPS if pattern_id in g), None)
                if group:
                    other_doms = [dominance.get(p, 0) for p in group if p != pattern_id]
                    # Only flag as anti-pattern if some OTHER pattern in the group dominates
                    if any(d >= 70 for d in other_doms):
                        violations.append(_build_violation(
                            target_path, pattern_id, dom_pct, peers, dominance, missing=False,
                        ))

    # ── 3. Drift score from REAL violation count weighted by severity ──
    sev_weights = {"high": 25, "medium": 12, "low": 5, "info": 1}
    drift_score = min(100, sum(sev_weights[v.severity] for v in violations))

    # ── 4. LLM only for the executive summary ──
    summary_prompt = (
        f"REPOSITORY: {repo.full_name}\n"
        f"FILES ANALYZED: {len(body.file_paths)}\n"
        f"PEER SET SIZE (largest): {peer_set_size}\n"
        f"VIOLATIONS FOUND: {len(violations)}\n"
        f"DRIFT SCORE: {drift_score}/100\n\n"
        f"VIOLATIONS BY PATTERN:\n" +
        "\n".join(f"  - {v.pattern_name} in {v.file_path} (peer dominance: {v.peer_dominance_pct:.0f}%)"
                 for v in violations[:8]) +
        "\n\nWrite a 2-3 sentence summary about the consistency of these changes. "
        "Stay grounded in the numbers above. Don't invent specifics. "
        "Return STRICT JSON: { \"summary\": str }"
    )
    try:
        llm = await claude_complete_json(
            system="You analyze REAL drift findings. Never invent files or patterns. Return STRICT JSON.",
            prompt=summary_prompt,
        )
    except Exception:
        llm = {}

    return DriftReport(
        repository_id=repo.id,
        repository_name=repo.full_name,
        summary=llm.get("summary") or
            (f"Found {len(violations)} consistency issue(s) across {len(body.file_paths)} file(s)."
             if violations else "No significant drift detected — changes follow established patterns."),
        files_analyzed=len(body.file_paths),
        peer_set_size=peer_set_size,
        violations=violations,
        drift_score=drift_score,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _peer_set(target_path: str, all_files: dict[str, str], exclude: set[str]) -> dict[str, str]:
    """
    Return files that are 'peers' of the target — same extension AND in the same
    directory or close to it. We use a tiered approach: prefer same-directory
    peers, then expand outward by extension.
    """
    target_ext = "." + target_path.rsplit(".", 1)[-1] if "." in target_path else ""
    if not target_ext:
        return {}

    target_dir = target_path.rsplit("/", 1)[0] if "/" in target_path else ""

    # Tier 1: same directory + same extension
    same_dir = {p: c for p, c in all_files.items()
                if p != target_path and p not in exclude
                and p.endswith(target_ext)
                and (p.rsplit("/", 1)[0] if "/" in p else "") == target_dir}
    if len(same_dir) >= 5:
        return same_dir

    # Tier 2: same parent path prefix + same extension
    if target_dir:
        parent = target_dir.rsplit("/", 1)[0] if "/" in target_dir else target_dir
        same_parent = {p: c for p, c in all_files.items()
                       if p != target_path and p not in exclude
                       and p.endswith(target_ext)
                       and p.startswith(parent + "/")}
        if len(same_parent) >= 5:
            return same_parent

    # Tier 3: any file with the same extension
    same_ext = {p: c for p, c in all_files.items()
                if p != target_path and p not in exclude
                and p.endswith(target_ext)}
    return same_ext


def _compute_dominance(peers: dict[str, str]) -> dict[str, float]:
    """For each pattern, return the % of peer files exhibiting it."""
    if not peers:
        return {}
    counts: dict[str, int] = defaultdict(int)
    total = len(peers)
    for path, content in peers.items():
        if not content:
            continue
        for pattern_id, fn in PATTERNS.items():
            try:
                if fn(content):
                    counts[pattern_id] += 1
            except Exception:
                continue
    return {p: round((c / total) * 100, 1) for p, c in counts.items()}


def _build_violation(target_path: str, pattern_id: str, dom_pct: float,
                     peers: dict[str, str], dominance: dict[str, float],
                     missing: bool) -> DriftViolation:
    """Build a DriftViolation with real peer-file evidence."""
    pattern_name = pattern_id.replace("_", " ").title()

    # Find real peer files that exhibit (or don't exhibit) the pattern
    examples: list[str] = []
    for path, content in peers.items():
        try:
            has_it = PATTERNS[pattern_id](content)
            if missing and has_it:
                examples.append(path)
            elif not missing and not has_it:
                examples.append(path)
        except Exception:
            continue
        if len(examples) >= 4:
            break

    if missing:
        description = (
            f"This file doesn't use `{pattern_name}` — but {dom_pct:.0f}% of similar files in the codebase do."
        )
        severity = "high" if dom_pct >= 95 else "medium" if dom_pct >= 85 else "low"
        suggested_fix = f"Consider using {pattern_name} for consistency with the rest of the codebase."
    else:
        description = (
            f"This file uses `{pattern_name}`, but only {dom_pct:.0f}% of similar files do — this looks like an outlier pattern."
        )
        severity = "medium" if dom_pct <= 2 else "low"
        suggested_fix = f"Consider whether `{pattern_name}` is the right approach here, or align with the codebase norm."

    return DriftViolation(
        file_path=target_path,
        pattern_id=pattern_id,
        pattern_name=pattern_name,
        description=description,
        severity=severity,
        peer_dominance_pct=dom_pct,
        peer_examples=examples,
        suggested_fix=suggested_fix,
    )


def _empty_report(repo, msg: str) -> DriftReport:
    return DriftReport(
        repository_id=repo.id,
        repository_name=repo.full_name,
        summary=msg,
        files_analyzed=0,
        peer_set_size=0,
        violations=[],
        drift_score=0,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
