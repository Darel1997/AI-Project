"""
Embedding / RAG pipeline service.

Uses a LOCAL embedding model (all-MiniLM-L6-v2) via sentence-transformers.
This runs entirely on your machine — no API key, no cost, no rate limits.

The model is ~80MB and downloads automatically on first use.
"""

import logging
import hashlib
from typing import List

import chromadb
from sentence_transformers import SentenceTransformer

from app.core.config import settings

logger = logging.getLogger("repoinsight.embedding")

# file extensions we consider "source code" worth indexing
INDEXABLE_EXTENSIONS = {
    # Programming languages
    ".py", ".pyi", ".pyx", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".java", ".kt", ".kts", ".scala", ".groovy",
    ".go", ".rs", ".rb", ".erb",
    ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx", ".ino",
    ".cs", ".vb", ".fs", ".fsx",
    ".php", ".phtml",
    ".swift", ".m", ".mm",
    ".pl", ".pm", ".t",
    ".r", ".R", ".jl",
    ".lua", ".ex", ".exs", ".elm", ".erl", ".hrl", ".clj", ".cljs", ".cljc",
    ".hs", ".lhs", ".ml", ".mli", ".nim", ".v", ".zig", ".dart",
    # Web / markup / style
    ".html", ".htm", ".xml", ".svg", ".css", ".scss", ".sass", ".less",
    ".vue", ".svelte", ".astro",
    # Config / data
    ".sql", ".graphql", ".gql", ".proto",
    ".yaml", ".yml", ".toml", ".json", ".jsonc", ".json5", ".ini", ".cfg", ".conf", ".env",
    # Shell / scripts
    ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
    # Infra / devops
    ".tf", ".tfvars", ".hcl", ".dockerfile", ".dockerignore",
    ".nix", ".bazel", ".bzl",
    # Documentation / prose
    ".md", ".mdx", ".markdown", ".rst", ".txt", ".adoc",
    # Misc
    ".makefile", ".mk", ".gradle", ".sbt", ".cmake",
}

# Also match these filenames directly (no extension or unusual names)
INDEXABLE_FILENAMES = {
    "dockerfile", "makefile", "rakefile", "gemfile", "procfile",
    "jenkinsfile", "vagrantfile", "cmakelists.txt",
    "readme", "license", "notice", "changelog", "authors", "contributors",
    ".gitignore", ".dockerignore", ".editorconfig", ".prettierrc", ".eslintrc",
    ".babelrc", ".npmrc", ".env",
}

CHUNK_SIZE = 60
CHUNK_OVERLAP = 10

# singleton so we only load the model once across all workers
_model = None


def _get_model() -> SentenceTransformer:
    """Lazy-load the embedding model (downloads ~80MB on first run)."""
    global _model
    if _model is None:
        logger.info("Loading local embedding model (all-MiniLM-L6-v2)...")
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded.")
    return _model


class EmbeddingService:
    """Manages the vector store for a single repository."""

    def __init__(self):
        self.chroma = chromadb.HttpClient(
            host=settings.CHROMA_HOST,
            port=settings.CHROMA_PORT,
        )

    def _collection_name(self, repo_id: int) -> str:
        return f"repo_{repo_id}"

    def _get_or_create_collection(self, repo_id: int):
        return self.chroma.get_or_create_collection(
            name=self._collection_name(repo_id),
            metadata={"hnsw:space": "cosine"},
        )

    # ── Chunking ──────────────────────────────────────────────────

    @staticmethod
    def should_index(file_path: str) -> bool:
        lower = file_path.lower()
        filename = lower.rsplit("/", 1)[-1]
        # 1) Match by extension
        if any(lower.endswith(ext) for ext in INDEXABLE_EXTENSIONS):
            return True
        # 2) Match by exact filename (e.g. Dockerfile, Makefile)
        if filename in INDEXABLE_FILENAMES:
            return True
        # 3) Strip version suffix and retry (e.g. "README", "Dockerfile.prod")
        if "." in filename:
            stem = filename.split(".")[0]
            if stem in INDEXABLE_FILENAMES:
                return True
        return False

    @staticmethod
    def chunk_file(content: str, file_path: str) -> List[dict]:
        lines = content.split("\n")
        chunks = []
        start = 0

        while start < len(lines):
            end = min(start + CHUNK_SIZE, len(lines))
            chunk_lines = lines[start:end]
            chunk_text = "\n".join(chunk_lines)

            if len(chunk_text.strip()) < 20:
                start = end
                continue

            chunk_id = hashlib.md5(
                f"{file_path}:{start}:{end}".encode()
            ).hexdigest()

            chunks.append({
                "id": chunk_id,
                "text": chunk_text,
                "metadata": {
                    "file_path": file_path,
                    "start_line": start + 1,
                    "end_line": end,
                    "total_lines": len(lines),
                },
            })

            start += CHUNK_SIZE - CHUNK_OVERLAP

        return chunks

    # ── Embedding (LOCAL — free, no API key) ──────────────────────

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings using the local sentence-transformers model."""
        if not texts:
            return []

        model = _get_model()
        embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
        return embeddings.tolist()

    # ── Indexing ──────────────────────────────────────────────────

    def index_file(self, repo_id: int, file_path: str, content: str) -> int:
        chunks = self.chunk_file(content, file_path)
        if not chunks:
            return 0

        collection = self._get_or_create_collection(repo_id)

        texts = [c["text"] for c in chunks]
        ids = [c["id"] for c in chunks]
        metadatas = [c["metadata"] for c in chunks]

        # embed in batches
        batch_size = 64
        for i in range(0, len(texts), batch_size):
            batch_texts = texts[i:i + batch_size]
            batch_ids = ids[i:i + batch_size]
            batch_meta = metadatas[i:i + batch_size]

            embeddings = self.generate_embeddings(batch_texts)
            collection.upsert(
                ids=batch_ids,
                embeddings=embeddings,
                documents=batch_texts,
                metadatas=batch_meta,
            )

        logger.info(f"Indexed {len(chunks)} chunks for {file_path}")
        return len(chunks)

    # ── Querying ──────────────────────────────────────────────────

    def query(self, repo_id: int, question: str, top_k: int = 8) -> List[dict]:
        collection = self._get_or_create_collection(repo_id)

        query_embedding = self.generate_embeddings([question])[0]

        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )

        hits = []
        if results and results["documents"]:
            for doc, meta, dist in zip(
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
            ):
                hits.append({
                    "text": doc,
                    "metadata": meta,
                    "relevance": round(1 - dist, 4),
                })

        return hits

    # ── Cleanup ───────────────────────────────────────────────────

    def delete_collection(self, repo_id: int):
        try:
            self.chroma.delete_collection(self._collection_name(repo_id))
            logger.info(f"Deleted vector collection for repo {repo_id}")
        except Exception as e:
            logger.warning(f"Could not delete collection for repo {repo_id}: {e}")
