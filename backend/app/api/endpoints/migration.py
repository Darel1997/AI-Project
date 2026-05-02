"""
Migration Assistant.

When a team decides to migrate (Python 3.10 → 3.13, Express → Fastify,
Postgres → MongoDB, REST → GraphQL, npm → pnpm, etc.), the hardest part
is the inventory: "which files need to change, in what order, with what
risk profile, and how long will each take?"

This feature answers that with REAL data:

  1. Detects the source tech in the indexed codebase by scanning manifests
     and import statements.
  2. For a chosen target, identifies every file that uses the source tech
     (real grep / import-graph search — not LLM guessing).
  3. Classifies each file by migration complexity using deterministic rules:
     - Trivial: import-rename only
     - Standard: idiomatic API differences, well-documented
     - Complex: behavioral differences requiring careful translation
     - Manual: requires architectural rethink (deferred to engineer)
  4. Builds a prioritized phased plan: Phase 1 (foundations), Phase 2 (core),
     Phase 3 (edges).
  5. LLM is used only for the prose explanation per migration recipe and
     the overall narrative — grounded in REAL file lists.

Migration knowledge base is HARDCODED (real, validated patterns) rather
than LLM-generated, so we don't fabricate migration steps.
"""

from __future__ import annotations
import json
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
router = APIRouter(prefix="/api/migration", tags=["migration"])


# ─────────────────────────────────────────────────────────────────
# Migration recipes — VALIDATED, real migration paths.
#
# Each recipe defines: how to detect the source, the target choices, and
# the actual API mapping rules. Keys in "rules" are regex patterns to find
# in source code; values describe the new pattern + complexity.
#
# This catalog is hand-built — not LLM-generated. Adding new migrations
# means adding new entries here, after verification.
# ─────────────────────────────────────────────────────────────────

MIGRATION_RECIPES = {
    # ── Express → Fastify ──
    "express-to-fastify": {
        "name": "Express → Fastify",
        "ecosystem": "npm",
        "source_detection": {
            "manifest_dep": "express",
            "import_patterns": [r"require\(['\"]express['\"]", r"from\s+['\"]express['\"]"],
        },
        "target": "fastify",
        "rules": [
            {"pattern": r"const\s+express\s*=\s*require\(['\"]express['\"]\)", "complexity": "trivial",
             "fix": "Replace with: const fastify = require('fastify')({ logger: true })"},
            {"pattern": r"app\.get\(['\"](.+?)['\"],\s*(?:async\s+)?\(req,\s*res\)\s*=>", "complexity": "standard",
             "fix": "Convert to: fastify.get('$1', async (request, reply) => { ... }). Note req→request, res→reply."},
            {"pattern": r"res\.json\(", "complexity": "trivial",
             "fix": "Replace with: reply.send(...)"},
            {"pattern": r"res\.status\(\d+\)\.send\(", "complexity": "trivial",
             "fix": "Replace with: reply.status(NNN).send(...)"},
            {"pattern": r"app\.use\(express\.json\(\)\)", "complexity": "trivial",
             "fix": "Remove — Fastify handles JSON natively."},
            {"pattern": r"\bnext\(\)", "complexity": "complex",
             "fix": "Fastify uses hooks instead of next() — refactor to onRequest / preHandler hooks."},
            {"pattern": r"app\.listen\(", "complexity": "trivial",
             "fix": "Replace with: await fastify.listen({ port: NNN })"},
        ],
    },

    # ── REST → GraphQL ──
    "rest-to-graphql": {
        "name": "REST → GraphQL (Apollo Server)",
        "ecosystem": "npm",
        "source_detection": {
            "import_patterns": [r"require\(['\"]express['\"]", r"@app\.route\(", r"FastAPI\(\)"],
            "path_patterns": [r"/(routes|endpoints|api)/"],
        },
        "target": "apollo-server",
        "rules": [
            {"pattern": r"app\.(get|post|put|delete|patch)\(['\"]([^'\"]+)['\"]", "complexity": "manual",
             "fix": "Each REST endpoint becomes a Query (GET) or Mutation (POST/PUT/DELETE). Plan the schema before code."},
            {"pattern": r"req\.params\.(\w+)", "complexity": "standard",
             "fix": "Path params become resolver arguments: (parent, { $1 }, context) => { ... }"},
            {"pattern": r"req\.query\.(\w+)", "complexity": "standard",
             "fix": "Query params become resolver arguments: (parent, { $1 }, context) => { ... }"},
            {"pattern": r"req\.body", "complexity": "standard",
             "fix": "Request body becomes input type — define an `input` and reference as resolver argument."},
        ],
    },

    # ── Python 3.10 → 3.12 ──
    "python-3.10-to-3.12": {
        "name": "Python 3.10 → 3.12",
        "ecosystem": "pypi",
        "source_detection": {
            "manifest_pattern": r'python\s*=\s*["\']3\.10',
            "file_patterns": [".python-version"],
        },
        "target": "python 3.12",
        "rules": [
            {"pattern": r"from\s+distutils", "complexity": "complex",
             "fix": "distutils is removed in Python 3.12. Migrate to setuptools or use packaging.* modules."},
            {"pattern": r"\bdatetime\.utcnow\(\)", "complexity": "trivial",
             "fix": "datetime.utcnow() is deprecated — use datetime.now(timezone.utc) instead."},
            {"pattern": r"asyncio\.get_event_loop\(\)", "complexity": "standard",
             "fix": "Deprecated when no loop running — use asyncio.get_running_loop() or asyncio.run()."},
            {"pattern": r"@asyncio\.coroutine", "complexity": "trivial",
             "fix": "Removed in 3.12. Use `async def` directly."},
        ],
    },

    # ── npm → pnpm ──
    "npm-to-pnpm": {
        "name": "npm → pnpm",
        "ecosystem": "npm",
        "source_detection": {
            "file_patterns": ["package-lock.json"],
        },
        "target": "pnpm",
        "rules": [
            {"pattern": r"package-lock\.json", "complexity": "trivial",
             "fix": "Delete package-lock.json. Run `pnpm install` to generate pnpm-lock.yaml."},
            {"pattern": r"\bnpm\s+install\b", "complexity": "trivial",
             "fix": "Replace with `pnpm install`. Update CI scripts."},
            {"pattern": r"\bnpm\s+run\s+", "complexity": "trivial",
             "fix": "Replace with `pnpm `. (pnpm runs scripts directly without `run`.)"},
            {"pattern": r'"workspaces"\s*:', "complexity": "complex",
             "fix": "Convert npm workspaces config to pnpm-workspace.yaml format."},
        ],
    },

    # ── Postgres → MongoDB (caution: usually inadvisable but supported) ──
    "postgres-to-mongo": {
        "name": "Postgres → MongoDB",
        "ecosystem": "any",
        "source_detection": {
            "import_patterns": [r"\bpsycopg2\b", r"\basyncpg\b", r"['\"]pg['\"]", r"sqlalchemy.create_engine\(['\"]postgres"],
        },
        "target": "mongodb",
        "rules": [
            {"pattern": r"sqlalchemy\.|declarative_base|create_engine", "complexity": "manual",
             "fix": "ORM → ODM (Mongoose / Motor / Beanie). Schema definitions need full rewrite."},
            {"pattern": r"\bJOIN\b", "complexity": "manual",
             "fix": "MongoDB has no native JOIN. Use $lookup aggregation OR denormalize the data."},
            {"pattern": r"\bSERIAL\b|\bSEQUENCE\b", "complexity": "complex",
             "fix": "Replace SERIAL with ObjectId or implement a counter collection for auto-incrementing IDs."},
            {"pattern": r"\bTRANSACTION\b|BEGIN;|COMMIT;", "complexity": "complex",
             "fix": "MongoDB transactions exist but with limitations. Verify your isolation requirements first."},
        ],
    },

    # ── jQuery → modern vanilla / framework ──
    "jquery-to-vanilla": {
        "name": "jQuery → Vanilla JS",
        "ecosystem": "npm",
        "source_detection": {
            "manifest_dep": "jquery",
            "import_patterns": [r"['\"]jquery['\"]", r"\$\("],
        },
        "target": "vanilla",
        "rules": [
            {"pattern": r"\$\(['\"]#([\w\-]+)['\"]\)", "complexity": "trivial",
             "fix": "Replace with: document.getElementById('$1')"},
            {"pattern": r"\$\(['\"]\.([\w\-]+)['\"]\)", "complexity": "trivial",
             "fix": "Replace with: document.querySelectorAll('.$1')"},
            {"pattern": r"\.on\(['\"]click['\"],\s*", "complexity": "trivial",
             "fix": "Replace with: .addEventListener('click', ...)"},
            {"pattern": r"\$\.ajax\(", "complexity": "standard",
             "fix": "Replace with: fetch(...)  — note response.json() is async."},
            {"pattern": r"\.fadeIn\(|\.fadeOut\(|\.slideUp\(|\.slideDown\(", "complexity": "complex",
             "fix": "Use CSS transitions + class toggling, or the Web Animations API."},
        ],
    },

    # ── Webpack → Vite ──
    "webpack-to-vite": {
        "name": "Webpack → Vite",
        "ecosystem": "npm",
        "source_detection": {
            "file_patterns": ["webpack.config.js", "webpack.config.ts"],
            "manifest_dep": "webpack",
        },
        "target": "vite",
        "rules": [
            {"pattern": r"webpack\.config\.", "complexity": "manual",
             "fix": "Create vite.config.ts. Most webpack plugins have Vite equivalents but config structure differs."},
            {"pattern": r"require\.context\(", "complexity": "complex",
             "fix": "Replace with import.meta.glob() — Vite's native equivalent."},
            {"pattern": r"process\.env\.NODE_ENV", "complexity": "trivial",
             "fix": "Replace with import.meta.env.MODE in client code."},
        ],
    },
}


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class DetectMigrationsRequest(BaseModel):
    repository_id: int


class AvailableMigration(BaseModel):
    recipe_id: str
    name: str
    target: str
    files_affected: int
    estimated_hours_total: int


class DetectionResult(BaseModel):
    repository_id: int
    repository_name: str
    available_migrations: List[AvailableMigration]
    generated_at: str


class PlanRequest(BaseModel):
    repository_id: int
    recipe_id: str


class FilePlan(BaseModel):
    file_path: str
    matches: int
    complexity: Literal["trivial", "standard", "complex", "manual"]
    estimated_minutes: int
    sample_findings: List[dict]   # [{pattern, line, fix}]


class MigrationPhase(BaseModel):
    name: str       # "Phase 1: Foundations" etc.
    description: str
    files: List[FilePlan]
    estimated_hours: int


class MigrationPlan(BaseModel):
    repository_id: int
    repository_name: str
    recipe_name: str
    target: str
    summary: str
    total_files: int
    estimated_hours_total: int
    complexity_breakdown: dict
    phases: List[MigrationPhase]
    risks: List[str]
    rollback_strategy: str
    generated_at: str


# ─────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────

@router.post("/detect",
    dependencies=[Depends(require_feature("migration_assistant"))],
    response_model=DetectionResult,
)
async def detect_migrations(
    body: DetectMigrationsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Scan the repo and return a list of migrations that ARE applicable —
    i.e., where we detected the source tech in the codebase.
    """
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    if not repo.is_indexed:
        raise HTTPException(status_code=400, detail="Repository must be indexed first")

    files_res = await db.execute(
        select(RepoFile.path, RepoFile.content).where(RepoFile.repository_id == body.repository_id)
    )
    files = [(p, c or "") for p, c in files_res]

    available: list[AvailableMigration] = []
    for recipe_id, recipe in MIGRATION_RECIPES.items():
        affected = _count_affected_files(recipe, files)
        if affected > 0:
            est_hours = _rough_estimate_hours(affected, recipe)
            available.append(AvailableMigration(
                recipe_id=recipe_id,
                name=recipe["name"],
                target=recipe["target"],
                files_affected=affected,
                estimated_hours_total=est_hours,
            ))

    available.sort(key=lambda a: a.files_affected, reverse=True)

    return DetectionResult(
        repository_id=repo.id,
        repository_name=repo.full_name,
        available_migrations=available,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/plan",
    dependencies=[Depends(require_feature("migration_assistant"))],
    response_model=MigrationPlan,
)
async def build_migration_plan(
    body: PlanRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Build a phased migration plan for a chosen recipe.
    """
    if body.recipe_id not in MIGRATION_RECIPES:
        raise HTTPException(status_code=404, detail=f"Unknown recipe: {body.recipe_id}")
    recipe = MIGRATION_RECIPES[body.recipe_id]

    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    files_res = await db.execute(
        select(RepoFile.path, RepoFile.content).where(RepoFile.repository_id == body.repository_id)
    )
    files = [(p, c or "") for p, c in files_res]

    # Per-file analysis: find matches, determine complexity, sample findings
    file_plans = _analyze_files(recipe, files)

    if not file_plans:
        return _empty_plan(repo, recipe, "No files matched this migration recipe.")

    # Phase the plan
    phases = _phase_files(file_plans)

    # Real complexity breakdown
    complexity_counts = Counter(fp.complexity for fp in file_plans)

    # Total estimate
    total_minutes = sum(fp.estimated_minutes for fp in file_plans)
    total_hours = round(total_minutes / 60)

    # Real risks based on counts
    risks: list[str] = []
    if complexity_counts.get("manual", 0) > 0:
        risks.append(f"{complexity_counts['manual']} file(s) require manual rethinking — these are not mechanical translations.")
    if complexity_counts.get("complex", 0) > 5:
        risks.append(f"{complexity_counts['complex']} complex translations — schedule pair-programming sessions.")
    if total_hours > 80:
        risks.append("Estimated effort exceeds 2 weeks — consider phased rollout with feature flags.")
    if any("manifest" in fp.file_path.lower() or fp.file_path in ("package.json", "Cargo.toml", "pyproject.toml") for fp in file_plans):
        risks.append("Manifest changes required — coordinate with CI/deployment infrastructure.")

    rollback = (
        "Pin the source library at the current version in a git branch before starting. "
        "Use feature flags to gate any behavioral changes. Keep the migration in a separate PR per phase "
        "so each phase can be reverted independently if production issues surface."
    )

    # LLM only for the human summary, grounded in real numbers
    summary_data = {
        "recipe": recipe["name"],
        "total_files": len(file_plans),
        "estimated_hours": total_hours,
        "trivial": complexity_counts.get("trivial", 0),
        "standard": complexity_counts.get("standard", 0),
        "complex": complexity_counts.get("complex", 0),
        "manual": complexity_counts.get("manual", 0),
        "phase_count": len(phases),
    }
    prompt = (
        f"MIGRATION PLAN DATA:\n"
        f"  Recipe: {summary_data['recipe']}\n"
        f"  Total files affected: {summary_data['total_files']}\n"
        f"  Trivial: {summary_data['trivial']}, Standard: {summary_data['standard']}, "
        f"Complex: {summary_data['complex']}, Manual: {summary_data['manual']}\n"
        f"  Estimated effort: {summary_data['estimated_hours']} hours\n"
        f"  Phase count: {summary_data['phase_count']}\n\n"
        "Write a 3-4 sentence executive summary for a tech lead about this migration. "
        "Be honest about the effort. Don't invent specific file paths. "
        "Return STRICT JSON: { \"summary\": str }"
    )
    try:
        llm = await claude_complete_json(
            system="You write migration summaries from REAL counts. Never invent files. Return STRICT JSON.",
            prompt=prompt,
        )
    except Exception:
        llm = {}

    return MigrationPlan(
        repository_id=repo.id,
        repository_name=repo.full_name,
        recipe_name=recipe["name"],
        target=recipe["target"],
        summary=llm.get("summary") or
            f"Migrating to {recipe['name']}: {len(file_plans)} files affected, ~{total_hours} hours of work across {len(phases)} phases.",
        total_files=len(file_plans),
        estimated_hours_total=total_hours,
        complexity_breakdown=dict(complexity_counts),
        phases=phases,
        risks=risks,
        rollback_strategy=rollback,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _count_affected_files(recipe: dict, files: list[tuple[str, str]]) -> int:
    """Quick count of files matching the recipe's source detection."""
    detection = recipe.get("source_detection", {})
    manifest_dep = detection.get("manifest_dep")
    manifest_pattern = detection.get("manifest_pattern")
    import_patterns = [re.compile(p) for p in detection.get("import_patterns", [])]
    file_patterns = detection.get("file_patterns", [])

    count = 0
    for path, content in files:
        if not content:
            continue
        # Manifest-based detection
        if manifest_dep and path in ("package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "Gemfile"):
            if f'"{manifest_dep}"' in content or f"'{manifest_dep}'" in content or f"\n{manifest_dep}" in content:
                count += 1
                continue
        if manifest_pattern and re.search(manifest_pattern, content):
            count += 1
            continue
        # File-name detection
        if any(path.endswith(fp) or path == fp for fp in file_patterns):
            count += 1
            continue
        # Import-pattern detection
        for pat in import_patterns:
            if pat.search(content):
                count += 1
                break
    return count


def _rough_estimate_hours(affected_count: int, recipe: dict) -> int:
    """Rough estimate before per-file analysis. Refined in _analyze_files."""
    return max(1, round(affected_count * 0.5))


def _analyze_files(recipe: dict, files: list[tuple[str, str]]) -> list[FilePlan]:
    """Per-file analysis: find rule matches, determine complexity, build plan."""
    plans: list[FilePlan] = []
    rules = recipe.get("rules", [])

    # Pre-compile patterns once
    compiled_rules = [(re.compile(r["pattern"]), r) for r in rules]

    for path, content in files:
        if not content:
            continue
        # Skip lockfiles, node_modules, etc.
        if any(skip in path for skip in ("node_modules/", "__pycache__/", ".lock", "dist/", "build/")):
            continue

        findings: list[dict] = []
        worst_complexity = "trivial"
        complexity_rank = {"trivial": 0, "standard": 1, "complex": 2, "manual": 3}

        for compiled, rule in compiled_rules:
            for match in compiled.finditer(content):
                # Compute the line number of the match
                line_num = content[:match.start()].count("\n") + 1
                findings.append({
                    "pattern": rule["pattern"][:80],
                    "line": line_num,
                    "fix": rule["fix"],
                    "complexity": rule["complexity"],
                    "matched_text": match.group(0)[:100],
                })
                if complexity_rank[rule["complexity"]] > complexity_rank[worst_complexity]:
                    worst_complexity = rule["complexity"]
                if len(findings) >= 20:
                    break
            if len(findings) >= 20:
                break

        if not findings:
            continue

        # Estimate per-file effort
        effort_per_complexity = {"trivial": 5, "standard": 15, "complex": 45, "manual": 120}
        # Take the worst-case-per-finding average rather than summing — simpler files
        # don't take 100x as long just because they have 100 trivial replacements
        match_count = len(findings)
        base_minutes = effort_per_complexity[worst_complexity]
        # Diminishing returns: each additional finding adds less time
        estimated = int(base_minutes + (match_count - 1) * (base_minutes * 0.3))
        estimated = min(estimated, 480)  # cap at 8 hours per file

        plans.append(FilePlan(
            file_path=path,
            matches=match_count,
            complexity=worst_complexity,
            estimated_minutes=estimated,
            sample_findings=findings[:5],
        ))

    return plans


def _phase_files(file_plans: list[FilePlan]) -> list[MigrationPhase]:
    """
    Phase the plan by complexity and dependency. Real heuristic:
      Phase 1: manifest/config files + trivial-only files (foundations)
      Phase 2: standard complexity files (the bulk)
      Phase 3: complex + manual files (the hard parts)
    """
    config_files = []
    trivial_files = []
    standard_files = []
    complex_files = []

    config_extensions = ("package.json", "pyproject.toml", "requirements.txt", "Cargo.toml",
                         "Gemfile", "tsconfig.json", "webpack.config.js", "vite.config.ts",
                         ".babelrc", ".eslintrc")

    for fp in file_plans:
        if any(fp.file_path.endswith(ext) or fp.file_path == ext for ext in config_extensions):
            config_files.append(fp)
        elif fp.complexity == "trivial":
            trivial_files.append(fp)
        elif fp.complexity == "standard":
            standard_files.append(fp)
        else:  # complex or manual
            complex_files.append(fp)

    phases: list[MigrationPhase] = []

    if config_files or trivial_files:
        phase_files = config_files + trivial_files
        phases.append(MigrationPhase(
            name="Phase 1 · Foundations",
            description="Update manifests, configs, and files needing only mechanical replacements. Low risk, do these first to unblock the rest.",
            files=phase_files,
            estimated_hours=round(sum(f.estimated_minutes for f in phase_files) / 60),
        ))
    if standard_files:
        phases.append(MigrationPhase(
            name="Phase 2 · Core translation",
            description="Idiomatic API differences. These are well-documented but require thoughtful translation. Run tests after each file.",
            files=standard_files,
            estimated_hours=round(sum(f.estimated_minutes for f in standard_files) / 60),
        ))
    if complex_files:
        phases.append(MigrationPhase(
            name="Phase 3 · Hard cases",
            description="Behavioral differences and architectural rethinks. Pair-program these. Write integration tests before changing.",
            files=complex_files,
            estimated_hours=round(sum(f.estimated_minutes for f in complex_files) / 60),
        ))

    return phases


def _empty_plan(repo, recipe: dict, msg: str) -> MigrationPlan:
    return MigrationPlan(
        repository_id=repo.id,
        repository_name=repo.full_name,
        recipe_name=recipe["name"],
        target=recipe["target"],
        summary=msg,
        total_files=0,
        estimated_hours_total=0,
        complexity_breakdown={},
        phases=[],
        risks=[],
        rollback_strategy="",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
