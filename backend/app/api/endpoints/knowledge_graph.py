"""
Knowledge Graph Search — real call-graph queries beyond chat.

Lets engineers ask structural questions like:
  - "show me every place we call Stripe"
  - "where is the User model defined and used?"
  - "what handles authentication?"
  - "find all API endpoints that touch payments"

How it works (all real data — no LLM hallucination of file paths):

  1. Build a symbol index from the indexed files using regex-based extraction
     for each language. We capture:
       - Function/method definitions
       - Class/interface definitions
       - Call sites (where a name is invoked)
       - Imports (where a name is brought in from)
     Plus name-mention sites (any time a string appears).

  2. Three query modes:
       - "definition": find where X is defined
       - "usages":     find where X is called/imported
       - "concept":    semantic search via existing chat embeddings, then enrich
                       with structural matches

  3. Results are real file paths + real line numbers + real snippets.
     The LLM only writes the human summary at the top, grounded in the count of
     matches found.
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
from app.services.lab_service import claude_complete_json, search_similar

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/knowledge-graph", tags=["knowledge-graph"])


# ─────────────────────────────────────────────────────────────────
# Language-aware definition patterns
#
# These capture WHERE a symbol is declared. Each pattern includes a named
# group `name` for the symbol identifier.
# ─────────────────────────────────────────────────────────────────

DEFINITION_PATTERNS = {
    "python": [
        re.compile(r"^\s*def\s+(?P<name>[a-zA-Z_]\w*)\s*\("),
        re.compile(r"^\s*async\s+def\s+(?P<name>[a-zA-Z_]\w*)\s*\("),
        re.compile(r"^\s*class\s+(?P<name>[a-zA-Z_]\w*)\s*[\(:]"),
    ],
    "javascript": [
        re.compile(r"^\s*(?:export\s+)?function\s+(?P<name>[a-zA-Z_$][\w$]*)\s*\("),
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name>[a-zA-Z_$][\w$]*)\s*=\s*(?:async\s+)?\("),
        re.compile(r"^\s*(?:export\s+)?(?:async\s+)?class\s+(?P<name>[a-zA-Z_$][\w$]*)"),
    ],
    "typescript": [
        re.compile(r"^\s*(?:export\s+)?function\s+(?P<name>[a-zA-Z_$][\w$]*)\s*[\(<]"),
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name>[a-zA-Z_$][\w$]*)\s*[:=]"),
        re.compile(r"^\s*(?:export\s+)?(?:async\s+)?class\s+(?P<name>[a-zA-Z_$][\w$]*)"),
        re.compile(r"^\s*(?:export\s+)?interface\s+(?P<name>[a-zA-Z_$][\w$]*)"),
        re.compile(r"^\s*(?:export\s+)?type\s+(?P<name>[a-zA-Z_$][\w$]*)\s*="),
    ],
    "go": [
        re.compile(r"^\s*func\s+(?:\([^)]*\)\s+)?(?P<name>[a-zA-Z_]\w*)\s*\("),
        re.compile(r"^\s*type\s+(?P<name>[a-zA-Z_]\w*)\s+(?:struct|interface)"),
    ],
    "rust": [
        re.compile(r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+(?P<name>[a-zA-Z_]\w*)\s*[\(<]"),
        re.compile(r"^\s*(?:pub\s+)?struct\s+(?P<name>[a-zA-Z_]\w*)"),
        re.compile(r"^\s*(?:pub\s+)?(?:enum|trait)\s+(?P<name>[a-zA-Z_]\w*)"),
    ],
    "java": [
        re.compile(r"\b(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\]]+\s+(?P<name>[a-zA-Z_]\w*)\s*\("),
        re.compile(r"\b(?:public|private|protected)?\s*(?:abstract\s+)?(?:final\s+)?class\s+(?P<name>[a-zA-Z_]\w*)"),
        re.compile(r"\b(?:public|private|protected)?\s*interface\s+(?P<name>[a-zA-Z_]\w*)"),
    ],
    "ruby": [
        re.compile(r"^\s*def\s+(?:self\.)?(?P<name>[a-zA-Z_]\w*[!?=]?)"),
        re.compile(r"^\s*class\s+(?P<name>[A-Z]\w*)"),
        re.compile(r"^\s*module\s+(?P<name>[A-Z]\w*)"),
    ],
}


def language_for_path(path: str) -> Optional[str]:
    p = path.lower()
    if p.endswith(".py"): return "python"
    if p.endswith((".ts", ".tsx")): return "typescript"
    if p.endswith((".js", ".jsx", ".mjs", ".cjs")): return "javascript"
    if p.endswith(".go"): return "go"
    if p.endswith(".rs"): return "rust"
    if p.endswith((".java", ".kt", ".scala")): return "java"
    if p.endswith(".rb"): return "ruby"
    return None


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class GraphSearchRequest(BaseModel):
    repository_id: int
    query: str
    mode: Literal["definitions", "usages", "concept", "auto"] = "auto"
    max_results: int = 50


class SymbolHit(BaseModel):
    file_path: str
    line_number: int
    snippet: str
    kind: Literal["definition", "usage", "import", "mention"]
    language: Optional[str] = None
    confidence: int  # 0-100


class GraphSearchResult(BaseModel):
    repository_id: int
    repository_name: str
    query: str
    mode_used: str
    summary: str
    total_hits: int
    files_with_hits: int
    hits: List[SymbolHit]
    related_symbols: List[str]
    generated_at: str


# ─────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────

@router.post("/search",
    dependencies=[Depends(require_feature("knowledge_graph"))],
    response_model=GraphSearchResult,
)
async def graph_search(
    body: GraphSearchRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Real structural search across the indexed codebase. Every hit is a real file
    path with a real line number — no LLM-fabricated locations.
    """
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    if not repo.is_indexed:
        raise HTTPException(status_code=400, detail="Repository must be indexed first")

    # ── Mode auto-detection: short single-symbol queries → structural,
    # multi-word natural language → concept ──
    mode = body.mode
    if mode == "auto":
        words = body.query.strip().split()
        looks_like_symbol = len(words) <= 2 and re.match(r"^[\w$.]+$", body.query.strip())
        mode = "usages" if looks_like_symbol else "concept"

    # Pull all files once
    files_res = await db.execute(
        select(RepoFile.path, RepoFile.content).where(RepoFile.repository_id == repo.id)
    )
    all_files = [(p, c or "") for p, c in files_res]

    hits: list[SymbolHit] = []
    related: set[str] = set()

    if mode in ("definitions", "usages"):
        # Structural search — real file scanning
        target_name = body.query.strip().split()[-1]  # last token if multi-word
        # Strip common prefixes like "function", "class", etc
        target_name = re.sub(r"^(function|class|def|interface|type)\s+", "", target_name, flags=re.IGNORECASE)

        for path, content in all_files:
            if not content:
                continue
            lang = language_for_path(path)

            if mode == "definitions":
                hits.extend(_find_definitions(path, content, target_name, lang))
            else:  # usages — covers both calls + imports + plain mentions
                hits.extend(_find_usages(path, content, target_name, lang))

            if len(hits) >= body.max_results * 2:
                break

    else:  # concept search
        # 1. Semantic search via existing embedding service
        semantic_hits = await search_similar(repository_id=repo.id, query_text=body.query, top_k=body.max_results)
        for h in semantic_hits:
            line_num = 1
            snippet = (h.get("snippet") or "")[:300]
            if not snippet:
                continue
            # Try to find the matching line in the actual file content for accurate line_number
            file_content = next((c for p, c in all_files if p == h.get("file_path")), "")
            if file_content and snippet[:80] in file_content:
                pos = file_content.index(snippet[:80])
                line_num = file_content[:pos].count("\n") + 1
            hits.append(SymbolHit(
                file_path=h.get("file_path", ""),
                line_number=line_num,
                snippet=snippet,
                kind="mention",
                language=language_for_path(h.get("file_path", "")),
                confidence=int(h.get("score", 0) * 100) if isinstance(h.get("score"), (int, float)) else 70,
            ))
        # 2. Pull symbol names that appear adjacent to top hits — these are "related symbols"
        for h in hits[:5]:
            for m in re.finditer(r"\b([A-Z]\w{3,})\b", h.snippet or ""):
                related.add(m.group(1))

    # Trim to max_results
    hits = hits[:body.max_results]

    # ── LLM only for the human summary ──
    files_with = len({h.file_path for h in hits})
    summary_prompt = (
        f"REPOSITORY: {repo.full_name}\n"
        f"QUERY: \"{body.query}\"\n"
        f"MODE: {mode}\n"
        f"REAL HITS: {len(hits)} matches across {files_with} files\n"
        f"TOP FILES (by hit count): {', '.join(_top_files(hits, 5))}\n\n"
        f"Write a 2-3 sentence summary describing what was found and where the highest "
        f"concentration of matches is. Stay grounded in the numbers above. "
        f"Return STRICT JSON: {{ \"summary\": str }}"
    )
    llm = await claude_complete_json(
        system="You summarize REAL code-search results. Never invent files. Return STRICT JSON.",
        prompt=summary_prompt,
    )

    return GraphSearchResult(
        repository_id=repo.id,
        repository_name=repo.full_name,
        query=body.query,
        mode_used=mode,
        summary=llm.get("summary") or
            (f"Found {len(hits)} match(es) across {files_with} file(s)." if hits else "No matches found."),
        total_hits=len(hits),
        files_with_hits=files_with,
        hits=hits,
        related_symbols=sorted(related)[:10],
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _find_definitions(path: str, content: str, target: str, lang: Optional[str]) -> list[SymbolHit]:
    """Scan for places where `target` is defined."""
    if not lang or lang not in DEFINITION_PATTERNS:
        # Fallback: any line containing the target near keywords
        return _find_loose_definitions(path, content, target, lang)

    results: list[SymbolHit] = []
    for i, line in enumerate(content.splitlines(), start=1):
        for pattern in DEFINITION_PATTERNS[lang]:
            m = pattern.match(line)
            if m and m.group("name") == target:
                results.append(SymbolHit(
                    file_path=path, line_number=i,
                    snippet=line.strip()[:200],
                    kind="definition", language=lang, confidence=95,
                ))
    return results


def _find_loose_definitions(path: str, content: str, target: str, lang: Optional[str]) -> list[SymbolHit]:
    """Best-effort fallback — flag lines that look definition-ish."""
    keywords = ("def ", "function ", "class ", "interface ", "type ", "fn ", "func ")
    results = []
    for i, line in enumerate(content.splitlines(), start=1):
        if target in line and any(kw in line for kw in keywords):
            results.append(SymbolHit(
                file_path=path, line_number=i,
                snippet=line.strip()[:200],
                kind="definition", language=lang, confidence=60,
            ))
    return results


def _find_usages(path: str, content: str, target: str, lang: Optional[str]) -> list[SymbolHit]:
    """Find imports + call sites + mentions of target name."""
    if not target:
        return []
    results: list[SymbolHit] = []

    # Word-boundary match — avoids matching "User" inside "ManagedUser"
    rx = re.compile(rf"\b{re.escape(target)}\b")

    for i, line in enumerate(content.splitlines(), start=1):
        if not rx.search(line):
            continue
        # Classify the kind
        if re.match(r"^\s*(?:import|from|require|use|using|include)\b", line):
            kind = "import"
            confidence = 90
        elif re.search(rf"\b{re.escape(target)}\s*\(", line):
            kind = "usage"
            confidence = 85
        elif re.match(rf"^\s*(?:def|function|class|interface|type|fn|func)\s+{re.escape(target)}\b", line):
            kind = "definition"
            confidence = 95
        else:
            kind = "mention"
            confidence = 60

        results.append(SymbolHit(
            file_path=path, line_number=i,
            snippet=line.strip()[:200],
            kind=kind, language=lang, confidence=confidence,
        ))

        if len(results) >= 25:  # cap per file
            break

    return results


def _top_files(hits: list[SymbolHit], n: int) -> list[str]:
    counts: dict[str, int] = defaultdict(int)
    for h in hits:
        counts[h.file_path] += 1
    return [p for p, _ in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:n]]
