"""
Dependency Health Radar — uses REAL package registry + GitHub APIs.

Pipeline:
  1. Parse package.json / pyproject.toml / Cargo.toml from the indexed repo
  2. For each dependency, query the real registry (npm, PyPI, crates.io)
     to get last-release-date, version, repo URL
  3. Hit the GitHub repo for that package — real stars, real open issues,
     real last-pushed-at date
  4. Compute REAL maintainer health: stale = no release > 18 months,
     abandoned = no commits > 24 months
  5. LLM only for migration effort estimates and "alternatives" suggestions

No more fabricated maintainer-health verdicts.
"""

from __future__ import annotations
import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta
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
from app.services.lab_service import claude_complete_json

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dependency-radar", tags=["dependency-radar"])


class RadarRequest(BaseModel):
    repository_id: int
    include_dev_deps: bool = True
    risk_threshold: Literal["all", "medium", "high", "critical"] = "medium"


class Alternative(BaseModel):
    name: str
    fit_score: int
    reasons: List[str]
    migration_effort_hours: int
    maintainer_health: str


class DependencyFinding(BaseModel):
    name: str
    current_version: Optional[str] = None
    ecosystem: str
    last_release_days_ago: Optional[int] = None
    maintainer_health: Literal["healthy", "slowing", "stale", "abandoned", "unknown"]
    open_issues: Optional[int] = None
    stars: Optional[int] = None
    severity: Literal["low", "medium", "high", "critical"]
    concerns: List[str]
    used_in_files: List[str]
    usage_surface: str
    alternatives: List[Alternative]
    recommended_action: Literal["keep", "monitor", "plan-migration", "replace-urgent"]
    recommended_action_reason: str


class RadarReport(BaseModel):
    repository_id: int
    repository_name: str
    summary: str
    overall_health_score: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    findings: List[DependencyFinding]
    generated_at: str


@router.post("/scan", dependencies=[Depends(require_feature("dependency_radar"))], response_model=RadarReport)
async def scan_dependency_health(
    body: RadarRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # ── 1. Pull real manifest contents from indexed files ──
    manifest_paths = ["package.json", "pyproject.toml", "Cargo.toml", "requirements.txt", "Gemfile"]
    files_res = await db.execute(
        select(RepoFile).where(
            RepoFile.repository_id == body.repository_id,
            RepoFile.path.in_(manifest_paths),
        )
    )
    manifests = files_res.scalars().all()
    if not manifests:
        return _empty_report(repo, "No dependency manifests found in this repository.")

    # ── 2. Parse real dependency lists ──
    deps: list[tuple[str, str, str]] = []  # (name, version, ecosystem)
    for m in manifests:
        if m.path == "package.json":
            deps.extend(_parse_package_json(m.content, body.include_dev_deps))
        elif m.path == "pyproject.toml":
            deps.extend(_parse_pyproject(m.content))
        elif m.path == "requirements.txt":
            deps.extend(_parse_requirements_txt(m.content))
        elif m.path == "Cargo.toml":
            deps.extend(_parse_cargo(m.content))

    if not deps:
        return _empty_report(repo, "Manifests found but no dependencies could be parsed.")

    # Cap at 25 deps to keep scan fast and avoid rate limits
    deps = deps[:25]

    # ── 3. Find usage in indexed files (which files import each dep) ──
    usage_map = await _compute_usage_map(db, body.repository_id, [d[0] for d in deps])

    # ── 4. Query each registry for REAL health data ──
    findings: list[DependencyFinding] = []
    async with httpx.AsyncClient(timeout=10) as client:
        for dep_name, version, ecosystem in deps:
            real = await _fetch_dep_health(client, dep_name, ecosystem)
            severity, concerns, action, action_reason = _classify(real)

            # LLM only suggests alternatives — clearly labelled in the UI as inference
            alternatives = []
            if severity in ("high", "critical"):
                alts = await _llm_alternatives(dep_name, ecosystem, list(usage_map.get(dep_name, [])))
                alternatives = [Alternative(**a) for a in alts]

            findings.append(DependencyFinding(
                name=dep_name,
                current_version=version,
                ecosystem=ecosystem,
                last_release_days_ago=real.get("last_release_days_ago"),
                maintainer_health=real.get("maintainer_health", "unknown"),
                open_issues=real.get("open_issues"),
                stars=real.get("stars"),
                severity=severity,
                concerns=concerns,
                used_in_files=usage_map.get(dep_name, [])[:5],
                usage_surface=f"Imported in {len(usage_map.get(dep_name, []))} file(s)",
                alternatives=alternatives,
                recommended_action=action,
                recommended_action_reason=action_reason,
            ))

    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        counts[f.severity] += 1

    # Overall health is computed from real severity distribution
    overall = max(0, 100 - counts["critical"] * 20 - counts["high"] * 10 - counts["medium"] * 4)

    return RadarReport(
        repository_id=repo.id,
        repository_name=repo.full_name,
        summary=f"Scanned {len(findings)} dependencies across {len(manifests)} manifest(s). " +
                (f"{counts['critical']} critical, {counts['high']} high-priority concerns." if counts['critical'] + counts['high'] > 0
                 else "No critical issues detected."),
        overall_health_score=overall,
        critical_count=counts["critical"],
        high_count=counts["high"],
        medium_count=counts["medium"],
        low_count=counts["low"],
        findings=findings,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ── Manifest parsers ───────────────────────────────────────────────────

def _parse_package_json(content: str, include_dev: bool) -> list[tuple[str, str, str]]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return []
    out = []
    for k in (["dependencies", "devDependencies"] if include_dev else ["dependencies"]):
        for name, version in (data.get(k, {}) or {}).items():
            out.append((name, str(version), "npm"))
    return out


def _parse_pyproject(content: str) -> list[tuple[str, str, str]]:
    out = []
    # Crude TOML parse without tomllib dep — match `package = "version"` lines
    in_deps = False
    for line in content.splitlines():
        s = line.strip()
        if s.startswith("[") and "dependencies" in s.lower():
            in_deps = True
            continue
        if s.startswith("[") and "dependencies" not in s.lower():
            in_deps = False
            continue
        m = re.match(r'([a-zA-Z0-9_\-\.]+)\s*=\s*"([^"]+)"', s)
        if in_deps and m:
            out.append((m.group(1), m.group(2), "pypi"))
    return out


def _parse_requirements_txt(content: str) -> list[tuple[str, str, str]]:
    out = []
    for line in content.splitlines():
        s = line.strip().split("#")[0].strip()
        if not s or s.startswith("-"):
            continue
        m = re.match(r"([a-zA-Z0-9_\-\.]+)([=<>~!]+(.+))?", s)
        if m:
            out.append((m.group(1), m.group(3) or "", "pypi"))
    return out


def _parse_cargo(content: str) -> list[tuple[str, str, str]]:
    out = []
    in_deps = False
    for line in content.splitlines():
        s = line.strip()
        if s.startswith("[dependencies"):
            in_deps = True
            continue
        if s.startswith("["):
            in_deps = False
            continue
        m = re.match(r'([a-zA-Z0-9_\-]+)\s*=\s*"([^"]+)"', s)
        if in_deps and m:
            out.append((m.group(1), m.group(2), "cargo"))
    return out


# ── Real health-data fetchers ──────────────────────────────────────────

async def _fetch_dep_health(client: httpx.AsyncClient, name: str, ecosystem: str) -> dict:
    """Hit the appropriate registry + GitHub for real health signals."""
    info = {"maintainer_health": "unknown"}
    repo_url = None
    last_release: Optional[str] = None

    try:
        if ecosystem == "npm":
            r = await client.get(f"https://registry.npmjs.org/{name}")
            if r.status_code == 200:
                d = r.json()
                latest = d.get("dist-tags", {}).get("latest")
                if latest:
                    last_release = (d.get("time") or {}).get(latest)
                repo_url = (d.get("repository") or {}).get("url", "")
        elif ecosystem == "pypi":
            r = await client.get(f"https://pypi.org/pypi/{name}/json")
            if r.status_code == 200:
                d = r.json()
                releases = d.get("releases", {})
                if releases:
                    latest_ver = d["info"]["version"]
                    files = releases.get(latest_ver, [])
                    if files:
                        last_release = files[0].get("upload_time_iso_8601") or files[0].get("upload_time")
                repo_url = (d.get("info", {}).get("project_urls") or {}).get("Source") \
                    or (d.get("info", {}).get("project_urls") or {}).get("Repository") \
                    or d.get("info", {}).get("home_page", "")
        elif ecosystem == "cargo":
            r = await client.get(f"https://crates.io/api/v1/crates/{name}")
            if r.status_code == 200:
                d = r.json().get("crate", {})
                last_release = d.get("updated_at")
                repo_url = d.get("repository", "")
    except Exception as e:
        log.debug("registry fetch failed for %s: %s", name, e)

    # Compute days-since-last-release
    if last_release:
        try:
            dt = datetime.fromisoformat(last_release.replace("Z", "+00:00"))
            info["last_release_days_ago"] = (datetime.now(timezone.utc) - dt).days
        except Exception:
            pass

    # Get GitHub repo signals (stars, open issues, last push)
    if repo_url and "github.com" in repo_url:
        m = re.search(r"github\.com[/:]([\w\-\.]+)/([\w\-\.]+?)(?:\.git)?(?:/|$)", repo_url)
        if m:
            try:
                gr = await client.get(f"https://api.github.com/repos/{m.group(1)}/{m.group(2)}")
                if gr.status_code == 200:
                    g = gr.json()
                    info["stars"] = g.get("stargazers_count")
                    info["open_issues"] = g.get("open_issues_count")
                    pushed_at = g.get("pushed_at")
                    if pushed_at:
                        dt = datetime.fromisoformat(pushed_at.replace("Z", "+00:00"))
                        info["days_since_push"] = (datetime.now(timezone.utc) - dt).days
            except Exception as e:
                log.debug("github fetch failed for %s: %s", repo_url, e)

    # Compute REAL maintainer_health from real signals
    days_release = info.get("last_release_days_ago")
    days_push = info.get("days_since_push", days_release)
    if days_release is None and days_push is None:
        info["maintainer_health"] = "unknown"
    else:
        worst = max(filter(lambda x: x is not None, [days_release, days_push]) or [0])
        if worst > 730:    info["maintainer_health"] = "abandoned"
        elif worst > 540:  info["maintainer_health"] = "stale"
        elif worst > 365:  info["maintainer_health"] = "slowing"
        else:              info["maintainer_health"] = "healthy"

    return info


async def _compute_usage_map(db, repo_id: int, dep_names: list[str]) -> dict[str, list[str]]:
    """For each dep, find which indexed files import it. Pure string-search, no LLM."""
    res = await db.execute(
        select(RepoFile.path, RepoFile.content).where(RepoFile.repository_id == repo_id)
    )
    usage: dict[str, list[str]] = defaultdict(list)
    for path, content in res:
        if not content:
            continue
        # Match `import x from 'name'`, `from name import`, `require('name')`, `use name::`
        for dep in dep_names:
            patterns = [
                f'from "{dep}"', f"from '{dep}'",
                f"require(\"{dep}\")", f"require('{dep}')",
                f"from {dep} import", f"import {dep}",
                f"use {dep}::", f"extern crate {dep}",
            ]
            if any(p in content for p in patterns):
                usage[dep].append(path)
    return usage


def _classify(real: dict) -> tuple[str, list[str], str, str]:
    """Compute severity from real signals — no LLM judgment in the loop."""
    health = real.get("maintainer_health", "unknown")
    days = real.get("last_release_days_ago")
    concerns = []

    if health == "abandoned":
        concerns.append(f"No releases in {days} days — appears abandoned")
        return "critical", concerns, "replace-urgent", "Maintainer activity has effectively stopped"
    if health == "stale":
        concerns.append(f"No releases in {days} days")
        return "high", concerns, "plan-migration", "Release cadence has stalled — plan a migration window"
    if health == "slowing":
        concerns.append(f"Last release was {days} days ago")
        return "medium", concerns, "monitor", "Activity is slowing — keep watching for further degradation"
    if health == "healthy":
        return "low", [], "keep", "Maintainer is shipping regularly"
    return "medium", ["Could not verify maintainer health from public APIs"], "monitor", "Insufficient signal — manually verify"


async def _llm_alternatives(name: str, ecosystem: str, used_in_files: list[str]) -> list[dict]:
    """LLM proposes alternatives — output clearly labelled inference, not measurement."""
    prompt = (
        f"DEPENDENCY: {name}\n"
        f"ECOSYSTEM: {ecosystem}\n"
        f"USAGE: imported in {len(used_in_files)} files\n\n"
        f"Suggest up to 3 well-known alternative libraries from your training data. For each:\n"
        f"  name, fit_score (0-100), reasons (list), migration_effort_hours (int),\n"
        f"  maintainer_health (one of: healthy, slowing, stale)\n"
        f"Return STRICT JSON: {{ \"alternatives\": [...] }}"
    )
    out = await claude_complete_json(
        system="Suggest alternative libraries you genuinely know exist. Return STRICT JSON.",
        prompt=prompt,
    )
    return out.get("alternatives", [])[:3]


def _empty_report(repo, msg: str) -> RadarReport:
    return RadarReport(
        repository_id=repo.id,
        repository_name=repo.full_name,
        summary=msg,
        overall_health_score=100,
        critical_count=0, high_count=0, medium_count=0, low_count=0,
        findings=[],
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
