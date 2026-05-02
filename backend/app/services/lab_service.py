"""
Lab service shim — adapter layer between the new "Features Lab" endpoints
(blast_radius, onboarding_sim, tribal_knowledge, dependency_radar, time_machine)
and the real project services (AIService, EmbeddingService).

This keeps the feature endpoints readable with intent-revealing names while
letting the production services handle the actual LLM and vector work.
"""

from __future__ import annotations
import asyncio
import functools
import json
import logging
import re
from typing import Optional

from app.services.ai_service import _chat, _chat_async
from app.services.embedding_service import EmbeddingService

log = logging.getLogger(__name__)


async def claude_complete_json(
    system: str,
    prompt: str,
    schema_hint: Optional[dict] = None,
    feature_key: str = "_default",
) -> dict:
    """
    Send a prompt to the LLM and return parsed JSON. Always async — the
    underlying HTTP call runs off the event loop and respects the per-feature
    latency budget defined in `ai_service._FEATURE_BUDGETS`.

    Returns {} on any parse failure so callers can degrade gracefully.
    """
    try:
        # Inject the schema as a clarification in the prompt when provided.
        # Keeps the system prompt terse and moves schema into the user turn.
        full_prompt = prompt
        if schema_hint:
            full_prompt = (
                prompt
                + "\n\nSchema reference (return JSON matching this shape):\n"
                + json.dumps(schema_hint, indent=2)
            )

        raw = await _chat_async(
            system=system, user=full_prompt, feature_key=feature_key, temperature=0.3,
        )
        return _parse_json_lenient(raw)
    except Exception as e:
        log.warning("claude_complete_json failed: %s", e)
        return {}


async def search_similar(repository_id: int, query_text: str, top_k: int = 8) -> list[dict]:
    """
    Semantic vector search over a repository's indexed chunks.
    Normalizes return shape to: [{file_path, snippet, relevance}].
    Embedding lookups are CPU-bound so we offload them to the default thread
    pool — important for endpoints that combine search_similar with an LLM
    call inside an async handler.
    """
    try:
        loop = asyncio.get_running_loop()
        svc = EmbeddingService()
        hits = await loop.run_in_executor(
            None, functools.partial(svc.query, repository_id, query_text, top_k),
        )
    except Exception as e:
        log.warning("search_similar failed for repo=%s: %s", repository_id, e)
        return []

    # Real service returns [{"text", "metadata": {...}, "relevance"}]. Normalize.
    normalized = []
    for h in hits:
        meta = h.get("metadata") or {}
        normalized.append({
            "file_path": meta.get("file_path") or meta.get("path") or "",
            "snippet":   h.get("text") or "",
            "relevance": h.get("relevance") or 0.0,
        })
    return normalized


def _parse_json_lenient(raw: str) -> dict:
    """
    Extract JSON from an LLM response. Models sometimes wrap output in ```json fences
    or add a line of prose before/after. Try the strict parse first, then fall back
    to extracting the biggest {...} block.
    """
    raw = (raw or "").strip()
    if not raw:
        return {}
    # Strip fenced code blocks if present
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Extract the largest {...} region — handles preamble/postamble noise
    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    log.warning("Could not parse JSON from LLM response (len=%d)", len(raw))
    return {}
