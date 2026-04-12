"""
AI service — wraps OpenAI chat completions for all intelligence features.

Each method constructs a purpose-built prompt, sends it to GPT-4o,
and parses the structured response. Context from the vector store
is injected as system-level grounding.
"""

import json
import logging
from typing import List, Optional

from openai import OpenAI

from app.core.config import settings
from app.services.embedding_service import EmbeddingService

logger = logging.getLogger("repoinsight.ai")


class AIService:
    def __init__(self):
        self.openai = OpenAI(api_key=settings.OPENAI_API_KEY)
        self.model = settings.OPENAI_MODEL
        self.embedding_service = EmbeddingService()

    def _chat(self, system: str, user: str, temperature: float = 0.3) -> str:
        """Low-level wrapper around the chat completions API."""
        response = self.openai.chat.completions.create(
            model=self.model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=4096,
        )
        return response.choices[0].message.content.strip()

    # ── Chat with Repo (RAG) ──────────────────────────────────────

    def chat_with_repo(self, repo_id: int, question: str, history: List[dict] = None) -> dict:
        """
        Retrieves relevant code chunks from the vector store,
        injects them as context, and answers the user's question.
        """
        # retrieve relevant chunks
        hits = self.embedding_service.query(repo_id, question, top_k=8)

        # build context block
        context_parts = []
        sources = []
        for hit in hits:
            file_path = hit["metadata"]["file_path"]
            start = hit["metadata"]["start_line"]
            end = hit["metadata"]["end_line"]
            context_parts.append(
                f"--- {file_path} (lines {start}-{end}) ---\n{hit['text']}"
            )
            sources.append({
                "file_path": file_path,
                "snippet": hit["text"][:200],
                "relevance": hit["relevance"],
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

        # build message list with history for multi-turn
        messages = [{"role": "system", "content": system_prompt}]
        if history:
            for msg in history[-6:]:  # last 3 exchanges for context window budget
                messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": question})

        response = self.openai.chat.completions.create(
            model=self.model,
            temperature=0.2,
            messages=messages,
            max_tokens=4096,
        )

        answer = response.choices[0].message.content.strip()
        return {"answer": answer, "sources": sources}

    # ── Explain File ──────────────────────────────────────────────

    def explain_file(self, file_content: str, file_path: str) -> str:
        system = (
            "You are a senior software engineer reviewing code. "
            "Provide a clear, structured explanation of what this file does, "
            "its key functions/classes, design patterns used, and how it fits "
            "into a larger system. Use markdown formatting."
        )
        user = f"Explain this file (`{file_path}`):\n\n```\n{file_content[:8000]}\n```"
        return self._chat(system, user)

    # ── Generate Documentation ────────────────────────────────────

    def generate_documentation(self, repo_id: int, file_summaries: List[dict]) -> str:
        """
        Generates an architecture overview document for the entire repo.
        Takes a list of {path, summary} for each key file.
        """
        # also pull some context from the vector store
        hits = self.embedding_service.query(repo_id, "project structure and architecture", top_k=10)
        extra_context = "\n".join(
            f"- {h['metadata']['file_path']}: {h['text'][:150]}" for h in hits
        )

        file_list = "\n".join(
            f"- `{f['path']}`: {f['summary']}" for f in file_summaries[:40]
        )

        system = (
            "You are a technical writer creating documentation for a software project. "
            "Generate a comprehensive architecture overview document in Markdown that includes: "
            "1. Project Overview, 2. Architecture, 3. Key Components, "
            "4. Data Flow, 5. Setup Instructions, 6. API Reference (if applicable). "
            "Be thorough but readable."
        )
        user = (
            f"Generate documentation for this project.\n\n"
            f"FILE STRUCTURE:\n{file_list}\n\n"
            f"CODE SAMPLES:\n{extra_context}"
        )
        return self._chat(system, user, temperature=0.4)

    # ── Tech Debt Detection ───────────────────────────────────────

    def detect_tech_debt(self, repo_id: int, sample_files: List[dict]) -> dict:
        """
        Analyzes code samples and returns structured tech debt findings.
        """
        code_samples = "\n\n".join(
            f"--- {f['path']} ---\n{f['content'][:3000]}"
            for f in sample_files[:15]
        )

        system = (
            "You are a senior engineering consultant performing a code quality audit. "
            "Analyze the provided code and identify technical debt, code smells, and areas for improvement. "
            "Return your findings as valid JSON with this exact structure:\n"
            '{\n'
            '  "items": [\n'
            '    {\n'
            '      "file_path": "path/to/file",\n'
            '      "issue": "description of the issue",\n'
            '      "severity": "low|medium|high|critical",\n'
            '      "category": "complexity|duplication|naming|testing|dependency|security",\n'
            '      "suggestion": "how to fix it"\n'
            '    }\n'
            '  ],\n'
            '  "summary": "overall assessment paragraph",\n'
            '  "overall_score": 75\n'
            '}\n'
            "The overall_score should be 0-100 where 100 is perfect. "
            "Return ONLY valid JSON, no markdown fences."
        )
        user = f"Analyze this codebase for technical debt:\n\n{code_samples}"

        raw = self._chat(system, user, temperature=0.2)

        # parse the JSON response, with fallback
        try:
            # strip markdown fences if the model added them anyway
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1]
            if cleaned.endswith("```"):
                cleaned = cleaned.rsplit("```", 1)[0]
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.error(f"Failed to parse tech debt JSON: {raw[:200]}")
            return {
                "items": [],
                "summary": raw[:500],
                "overall_score": 50.0,
            }

    # ── Task Generation ───────────────────────────────────────────

    def generate_tasks(
        self, repo_id: int, sample_files: List[dict],
        focus_area: Optional[str] = None, count: int = 5,
    ) -> List[dict]:
        """Generates Jira-style engineering tasks from code analysis."""

        code_samples = "\n\n".join(
            f"--- {f['path']} ---\n{f['content'][:2000]}"
            for f in sample_files[:12]
        )

        focus = f" Focus specifically on: {focus_area}." if focus_area else ""

        system = (
            "You are a senior tech lead creating engineering tasks for a sprint. "
            f"Generate exactly {count} actionable Jira-style tasks.{focus}\n"
            "Return valid JSON as a list of objects with this structure:\n"
            '[\n'
            '  {\n'
            '    "title": "Short task title",\n'
            '    "description": "Detailed description with acceptance criteria",\n'
            '    "priority": "critical|high|medium|low",\n'
            '    "difficulty": "easy|medium|hard|complex",\n'
            '    "task_type": "bug|feature|refactor|docs|test",\n'
            '    "suggested_files": ["file1.py", "file2.py"]\n'
            '  }\n'
            ']\n'
            "Return ONLY the JSON array, no markdown."
        )
        user = f"Generate {count} engineering tasks based on this code:\n\n{code_samples}"

        raw = self._chat(system, user, temperature=0.4)

        try:
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1]
            if cleaned.endswith("```"):
                cleaned = cleaned.rsplit("```", 1)[0]
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.error(f"Failed to parse tasks JSON: {raw[:200]}")
            return []
