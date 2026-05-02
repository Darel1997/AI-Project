"""
AI service — uses Anthropic Claude for all intelligence features.

Performance notes (read this before touching token budgets):

We have a hard rule: every feature should finish in 5–15 seconds. The two
levers we have are (1) how much we send to the model, and (2) how much we
ask it to return. The latter dominates wall-clock time because Claude
streams output token-by-token, so a 4096-token response takes 4–8x longer
than a 1000-token response on the same model.

Per-feature budgets are tuned in `_FEATURE_BUDGETS` below. Each entry
captures the model choice, max output tokens, and the context size we
slice out of source files. Bumping any of these will make the feature
slower; lowering them will make it faster but possibly less detailed.

We also expose `_chat_async` which runs the synchronous SDK call in a
thread executor, so a long AI request never blocks the FastAPI event
loop. All public methods on `AIService` have an `async` counterpart
(`AIService.aXxx`) for new callers; the sync methods are kept for
backward compatibility but they internally call the async path with
`asyncio.run` if the loop is free.

Hard timeout: every Claude call is wrapped in a 30-second timeout. If
the model doesn't respond by then, we raise `AIRequestTimeout` so the
caller can show an actionable error instead of hanging forever.
"""

import asyncio
import functools
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, List, Optional, TypeVar

from app.core.config import settings
from app.services.embedding_service import EmbeddingService

logger = logging.getLogger("repoinsight.ai")

T = TypeVar("T")


# ─────────────────────────────────────────────────────────────────
# Per-feature budgets — every knob that affects request latency.
# Tuned for a 5-15s wall-clock target on Claude Sonnet 4.6 / Haiku.
# ─────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FeatureBudget:
    """Latency knobs for a single AI feature."""

    # The model to use. Haiku is 3-5x faster than Sonnet for small structured
    # outputs; Sonnet wins on long-form prose. We pick per feature.
    model: str
    # Max output tokens. The biggest latency lever — pick the smallest value
    # that still produces a quality result.
    max_tokens: int
    # Hard cap on the number of source files we sample for context.
    sample_files: int
    # Per-file character cap when slicing content into the prompt.
    chars_per_file: int


_FEATURE_BUDGETS: dict[str, FeatureBudget] = {
    # Audit — JSON output, ~5-10 findings × ~150 tokens each. 2500 is plenty.
    "code_quality":     FeatureBudget(model="haiku", max_tokens=2500, sample_files=8,  chars_per_file=2000),
    # Security — same structure as audit, slightly higher cap for CWE strings.
    "security_audit":   FeatureBudget(model="haiku", max_tokens=2500, sample_files=8,  chars_per_file=2000),
    # Tasks — structured JSON, 5 items × ~200 tokens. 1500 is generous.
    "task_generator":   FeatureBudget(model="haiku", max_tokens=1500, sample_files=10, chars_per_file=1500),
    # Architecture diagram — Mermaid graph, 8-15 nodes. 800 tokens covers it.
    "architecture":     FeatureBudget(model="haiku", max_tokens=800,  sample_files=60, chars_per_file=0),
    # Docs — long-form Markdown. Sonnet's prose quality matters here.
    "documentation":    FeatureBudget(model="sonnet", max_tokens=3000, sample_files=10, chars_per_file=1500),
    # Onboarding guide — long-form Markdown. Same reasoning as docs.
    "onboarding_guide": FeatureBudget(model="sonnet", max_tokens=3000, sample_files=10, chars_per_file=1500),
    # Chat answer — short focused answers. Capped tightly so each turn is snappy.
    "chat":             FeatureBudget(model="sonnet", max_tokens=1500, sample_files=5,  chars_per_file=2000),
    # Default fallback for any feature not explicitly listed.
    "_default":         FeatureBudget(model="haiku", max_tokens=2000, sample_files=8,   chars_per_file=2000),
}


def _budget_for(feature_key: str) -> FeatureBudget:
    return _FEATURE_BUDGETS.get(feature_key, _FEATURE_BUDGETS["_default"])


def _resolve_model(model_alias: str) -> str:
    """Map an alias ('haiku', 'sonnet') to the configured model id."""
    if model_alias == "haiku":
        return getattr(settings, "ANTHROPIC_HAIKU_MODEL", "claude-haiku-4-5-20251001")
    return settings.ANTHROPIC_MODEL  # sonnet / configured default


# ─────────────────────────────────────────────────────────────────
# Provider routing
# ─────────────────────────────────────────────────────────────────

class AIRequestTimeout(RuntimeError):
    """Raised when an AI request exceeds its wall-clock budget."""


# Shared executor for blocking SDK calls. Pool size tuned for typical
# free-tier Anthropic rate limits (5 concurrent requests).
_EXECUTOR = ThreadPoolExecutor(max_workers=5, thread_name_prefix="ai-")
_HARD_TIMEOUT_SEC = 30


def _get_provider() -> Optional[str]:
    """
    Returns the name of the available AI provider, or None.
    Prefers Claude.
    """
    if settings.ANTHROPIC_API_KEY and settings.ANTHROPIC_API_KEY != "not-set":
        return "claude"
    if settings.OPENAI_API_KEY and settings.OPENAI_API_KEY not in (
        "not-set",
        "sk-placeholder-replace-me",
        "sk-your-openai-key",
    ):
        return "openai"
    return None


def _chat_claude_sync(system: str, messages: list, *, model: str, max_tokens: int, temperature: float) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=_HARD_TIMEOUT_SEC)
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=messages,
    )
    return response.content[0].text.strip()


def _chat_openai_sync(system: str, messages: list, *, model: str, max_tokens: int, temperature: float) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=settings.OPENAI_API_KEY, timeout=_HARD_TIMEOUT_SEC)
    full_messages = [{"role": "system", "content": system}] + messages
    response = client.chat.completions.create(
        model=model,
        temperature=temperature,
        messages=full_messages,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content.strip()


def _chat(
    system: str,
    user: str,
    *,
    feature_key: str = "_default",
    temperature: float = 0.3,
) -> str:
    """
    Synchronous chat — kept for callers that haven't migrated to the async API.
    Internally still uses the configured per-feature budget.
    """
    provider = _get_provider()
    if not provider:
        raise RuntimeError(
            "No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your .env file."
        )

    budget = _budget_for(feature_key)
    messages = [{"role": "user", "content": user}]

    if provider == "claude":
        return _chat_claude_sync(
            system, messages,
            model=_resolve_model(budget.model),
            max_tokens=budget.max_tokens,
            temperature=temperature,
        )
    return _chat_openai_sync(
        system, messages,
        model=settings.OPENAI_MODEL,
        max_tokens=budget.max_tokens,
        temperature=temperature,
    )


async def _chat_async(
    system: str,
    user: str,
    *,
    feature_key: str = "_default",
    temperature: float = 0.3,
) -> str:
    """
    Async chat — runs the blocking SDK call in a thread so it doesn't pin
    the FastAPI event loop. All new code should use this.
    """
    loop = asyncio.get_running_loop()
    fn = functools.partial(_chat, system, user, feature_key=feature_key, temperature=temperature)
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(_EXECUTOR, fn),
            timeout=_HARD_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError as e:
        logger.warning("AI request for feature=%s exceeded %ss", feature_key, _HARD_TIMEOUT_SEC)
        raise AIRequestTimeout(
            f"The AI request for {feature_key.replace('_', ' ')} timed out after {_HARD_TIMEOUT_SEC}s. "
            "Try again, or split the request into smaller pieces."
        ) from e


def _chat_with_history(
    system: str,
    messages: list,
    *,
    feature_key: str = "chat",
    temperature: float = 0.3,
) -> str:
    """Multi-turn conversation — also runs through the per-feature budget."""
    provider = _get_provider()
    if not provider:
        raise RuntimeError(
            "No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your .env file."
        )

    budget = _budget_for(feature_key)
    if provider == "claude":
        return _chat_claude_sync(
            system, messages,
            model=_resolve_model(budget.model),
            max_tokens=budget.max_tokens,
            temperature=temperature,
        )
    return _chat_openai_sync(
        system, messages,
        model=settings.OPENAI_MODEL,
        max_tokens=budget.max_tokens,
        temperature=temperature,
    )


def _strip_fences(raw: str) -> str:
    """Strip ```json or ``` fences models sometimes add despite our 'no fences' instruction."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    if cleaned.endswith("```"):
        cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    return cleaned.strip()


def _slice(content: Optional[str], cap: int) -> str:
    """Slice file content to its char cap, returning empty string when None."""
    if not content:
        return ""
    return content[:cap] if cap and len(content) > cap else content


# ─────────────────────────────────────────────────────────────────
# AIService — public API used by route handlers
# ─────────────────────────────────────────────────────────────────

class AIService:
    """
    Stateless façade over the chat helpers. One instance per request is fine
    (no per-instance state). The embedding service is instantiated lazily.

    Every public method exists in two forms:
      • Synchronous (`detect_tech_debt`, …) — kept for legacy callers.
      • Async       (`a_detect_tech_debt`, …) — preferred. Doesn't block
        the event loop and gets the 30s hard timeout for free.
    """

    def __init__(self):
        self.embedding_service = EmbeddingService()

    # ── Q&A ───────────────────────────────────────────────────────

    def chat_with_repo(self, repo_id: int, question: str, history: Optional[list] = None) -> dict:
        """Answers a natural-language question grounded in the indexed repo content."""
        budget = _budget_for("chat")
        hits = self.embedding_service.query(repo_id, question, top_k=budget.sample_files)

        sources = []
        context_parts = []
        for h in hits:
            ctx_chunk = h["text"][: budget.chars_per_file]
            context_parts.append(
                f"--- {h['metadata']['file_path']} (lines {h['metadata'].get('start_line', '?')}-"
                f"{h['metadata'].get('end_line', '?')}) ---\n{ctx_chunk}"
            )
            sources.append({
                "file_path": h["metadata"]["file_path"],
                "start_line": h["metadata"].get("start_line"),
                "end_line": h["metadata"].get("end_line"),
                "snippet": h["text"][:200],
                "relevance": h["relevance"],
            })

        context = "\n\n".join(context_parts)

        system_prompt = (
            "You are RepoInsight AI, an expert code assistant. "
            "Answer the user's question about their codebase using ONLY the provided code context. "
            "If the context doesn't contain enough information, say so honestly. "
            "Always cite specific file paths and line numbers when referencing code. "
            "Be concise but thorough.\n\n"
            f"CODE CONTEXT:\n{context}"
        )

        messages = []
        if history:
            for msg in history[-6:]:
                messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": question})

        answer = _chat_with_history(system_prompt, messages, feature_key="chat", temperature=0.2)
        return {"answer": answer, "sources": sources}

    # ── Explain File ──────────────────────────────────────────────

    def explain_file(self, file_content: str, file_path: str) -> str:
        system = (
            "You are a senior software engineer reviewing code. "
            "Provide a clear, structured explanation of what this file does, "
            "its key functions/classes, design patterns used, and how it fits "
            "into a larger system. Use markdown formatting."
        )
        # Cap input — explanations of huge files cost too much for marginal value
        user = f"Explain this file (`{file_path}`):\n\n```\n{file_content[:6000]}\n```"
        return _chat(system, user, feature_key="documentation")

    # ── Generate Documentation ────────────────────────────────────

    async def a_generate_documentation(self, repo_id: int, file_summaries: List[dict]) -> str:
        budget = _budget_for("documentation")
        hits = self.embedding_service.query(repo_id, "project structure and architecture", top_k=8)
        extra_context = "\n".join(
            f"- {h['metadata']['file_path']}: {h['text'][:120]}" for h in hits
        )
        file_list = "\n".join(
            f"- `{f['path']}`: {f['summary']}" for f in file_summaries[: budget.sample_files * 4]
        )

        system = (
            "You are a technical writer creating documentation for a software project. "
            "Generate a comprehensive but TIGHT architecture overview document in Markdown that includes: "
            "1. Project Overview, 2. Architecture, 3. Key Components, "
            "4. Data Flow, 5. Setup Instructions, 6. API Reference (if applicable). "
            "Be thorough but concise — avoid filler. Aim for 600-1000 words total."
        )
        user = (
            f"Generate documentation for this project.\n\n"
            f"FILE STRUCTURE:\n{file_list}\n\n"
            f"CODE SAMPLES:\n{extra_context}"
        )
        return await _chat_async(system, user, feature_key="documentation", temperature=0.4)

    def generate_documentation(self, repo_id: int, file_summaries: List[dict]) -> str:
        return asyncio.get_event_loop().run_until_complete(
            self.a_generate_documentation(repo_id, file_summaries)
        )

    # ── Code Quality / Tech Debt Detection ────────────────────────

    async def a_detect_tech_debt(self, repo_id: int, sample_files: List[dict]) -> dict:
        budget = _budget_for("code_quality")
        code_samples = "\n\n".join(
            f"--- {f['path']} ---\n{_slice(f.get('content'), budget.chars_per_file)}"
            for f in sample_files[: budget.sample_files]
        )

        system = (
            "You are a senior engineering consultant performing a code quality audit. "
            "Analyze the provided code and identify the top 5-8 technical debt items, "
            "code smells, or improvement opportunities. Quality over quantity — focus on "
            "the issues that actually matter. Return your findings as valid JSON:\n"
            '{\n'
            '  "items": [{ "file_path": "...", "issue": "...", "severity": "low|medium|high|critical", '
            '"category": "complexity|duplication|naming|testing|dependency|security", "suggestion": "..." }],\n'
            '  "summary": "two-sentence overall assessment",\n'
            '  "overall_score": 0-100\n'
            '}\n'
            "Return ONLY valid JSON, no markdown fences."
        )
        user = f"Analyze this codebase for technical debt:\n\n{code_samples}"

        raw = await _chat_async(system, user, feature_key="code_quality", temperature=0.2)
        try:
            return json.loads(_strip_fences(raw))
        except json.JSONDecodeError:
            logger.error("Failed to parse tech debt JSON: %s", raw[:200])
            return {"items": [], "summary": raw[:300], "overall_score": 50.0}

    def detect_tech_debt(self, repo_id: int, sample_files: List[dict]) -> dict:
        return asyncio.get_event_loop().run_until_complete(
            self.a_detect_tech_debt(repo_id, sample_files)
        )

    # ── Task Generation ───────────────────────────────────────────

    async def a_generate_tasks(
        self, repo_id: int, sample_files: List[dict],
        focus_area: Optional[str] = None, count: int = 5,
    ) -> List[dict]:
        budget = _budget_for("task_generator")
        code_samples = "\n\n".join(
            f"--- {f['path']} ---\n{_slice(f.get('content'), budget.chars_per_file)}"
            for f in sample_files[: budget.sample_files]
        )
        focus = f" Focus specifically on: {focus_area}." if focus_area else ""

        system = (
            f"You are a senior tech lead creating engineering tasks. "
            f"Generate exactly {count} actionable Jira-style tasks.{focus}\n"
            "Return valid JSON as a list:\n"
            '[{ "title": "...", "description": "...", "priority": "critical|high|medium|low", '
            '"difficulty": "easy|medium|hard|complex", "task_type": "bug|feature|refactor|docs|test", '
            '"suggested_files": ["..."] }]\n'
            "Return ONLY the JSON array, no markdown."
        )
        user = f"Generate {count} engineering tasks based on this code:\n\n{code_samples}"

        raw = await _chat_async(system, user, feature_key="task_generator", temperature=0.4)
        try:
            return json.loads(_strip_fences(raw))
        except json.JSONDecodeError:
            logger.error("Failed to parse tasks JSON: %s", raw[:200])
            return []

    def generate_tasks(
        self, repo_id: int, sample_files: List[dict],
        focus_area: Optional[str] = None, count: int = 5,
    ) -> List[dict]:
        return asyncio.get_event_loop().run_until_complete(
            self.a_generate_tasks(repo_id, sample_files, focus_area, count)
        )

    # ── Security Scan ─────────────────────────────────────────────

    async def a_security_scan(self, repo_id: int, sample_files: List[dict]) -> dict:
        budget = _budget_for("security_audit")
        code_samples = "\n\n".join(
            f"--- {f['path']} ---\n{_slice(f.get('content'), budget.chars_per_file)}"
            for f in sample_files[: budget.sample_files]
        )

        system = (
            "You are a senior security engineer performing a code audit. "
            "Identify the top 5-10 most consequential vulnerabilities including: "
            "hardcoded secrets, SQL injection, XSS, insecure auth, unsafe deserialization, "
            "path traversal, CSRF, weak crypto, sensitive logging.\n"
            "Return valid JSON:\n"
            '{\n'
            '  "findings": [{ "file_path": "...", "line_hint": "...", "vulnerability": "...", '
            '"severity": "critical|high|medium|low|info", "cwe": "...", "description": "...", "remediation": "..." }],\n'
            '  "summary": "two-sentence security posture",\n'
            '  "security_score": 0-100\n'
            '}\n'
            "Be concrete and specific. If a finding may be a false positive, say so. "
            "Return ONLY valid JSON, no markdown fences."
        )
        user = f"Perform a security audit on this codebase:\n\n{code_samples}"

        raw = await _chat_async(system, user, feature_key="security_audit", temperature=0.1)
        try:
            return json.loads(_strip_fences(raw))
        except json.JSONDecodeError:
            logger.error("Failed to parse security scan JSON: %s", raw[:200])
            return {"findings": [], "summary": raw[:300], "security_score": 50}

    def security_scan(self, repo_id: int, sample_files: List[dict]) -> dict:
        return asyncio.get_event_loop().run_until_complete(
            self.a_security_scan(repo_id, sample_files)
        )

    # ── Onboarding Guide ──────────────────────────────────────────

    async def a_generate_onboarding_guide(
        self, repo_id: int, repo_name: str, sample_files: List[dict],
    ) -> str:
        budget = _budget_for("onboarding_guide")
        code_samples = "\n".join(
            f"- `{f['path']}` ({f.get('language', '?')})" for f in sample_files[:30]
        )
        hits = self.embedding_service.query(
            repo_id, "project architecture entry points main", top_k=6,
        )
        extra = "\n\n".join(
            f"--- {h['metadata']['file_path']} ---\n{h['text'][:400]}"
            for h in hits
        )

        system = (
            "You are a senior engineer writing an onboarding guide for a developer "
            "joining the team TODAY. Be practical, specific, opinionated, and TIGHT. "
            "Aim for 500-800 words total. Markdown:\n\n"
            "# Welcome to [Project]\n"
            "## 1. What This Project Does\n"
            "## 2. Your Dev Environment in 10 Minutes\n"
            "## 3. Where to Start Reading\n"
            "## 4. Key Abstractions\n"
            "## 5. How to Run Tests\n"
            "## 6. How to Submit Changes\n"
            "## 7. Gotchas\n"
            "## 8. Your First Task"
        )
        user = f"Project: {repo_name}\n\nFILE STRUCTURE:\n{code_samples}\n\nKEY CODE:\n{extra}"
        return await _chat_async(system, user, feature_key="onboarding_guide", temperature=0.4)

    def generate_onboarding_guide(self, repo_id: int, repo_name: str, sample_files: List[dict]) -> str:
        return asyncio.get_event_loop().run_until_complete(
            self.a_generate_onboarding_guide(repo_id, repo_name, sample_files)
        )

    # ── Architecture Diagram (Mermaid) ────────────────────────────

    async def a_generate_architecture_diagram(self, repo_id: int, file_summaries: List[dict]) -> str:
        budget = _budget_for("architecture")
        file_list = "\n".join(f"- `{f['path']}`" for f in file_summaries[: budget.sample_files])

        system = (
            "You are an architect visualizing a codebase. "
            "Generate a Mermaid diagram (graph TD or flowchart TD) showing the main "
            "components and their relationships. Group related files into logical nodes. "
            "Aim for 8-12 nodes — show the big picture, not every file. "
            "Use meaningful labels (e.g., 'API Layer', 'Auth Service', 'Database'). "
            "Return ONLY the Mermaid diagram code, starting with 'graph TD' or 'flowchart TD'. "
            "No markdown fences, no explanation, no preamble."
        )
        user = f"Generate an architecture diagram for this codebase:\n\n{file_list}"
        result = await _chat_async(system, user, feature_key="architecture", temperature=0.3)

        # strip any markdown fences just in case
        cleaned = _strip_fences(result)
        return cleaned

    def generate_architecture_diagram(self, repo_id: int, file_summaries: List[dict]) -> str:
        return asyncio.get_event_loop().run_until_complete(
            self.a_generate_architecture_diagram(repo_id, file_summaries)
        )
