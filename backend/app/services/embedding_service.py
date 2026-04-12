"""
Embedding / RAG pipeline service.

Handles the full retrieval-augmented generation flow:
1. Chunk source files into overlapping segments
2. Generate embeddings via OpenAI
3. Store vectors in ChromaDB
4. Query the vector store for relevant context
"""

import logging
import hashlib
from typing import List

import chromadb
from openai import OpenAI

from app.core.config import settings

logger = logging.getLogger("repoinsight.embedding")

# file extensions we consider "source code" worth indexing
INDEXABLE_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".go", ".rs", ".rb",
    ".cpp", ".c", ".h", ".hpp", ".cs", ".php", ".swift", ".kt", ".scala",
    ".sql", ".sh", ".bash", ".yaml", ".yml", ".toml", ".json", ".md",
    ".html", ".css", ".scss", ".vue", ".svelte", ".tf", ".dockerfile",
}

# max lines per chunk, with overlap
CHUNK_SIZE = 60
CHUNK_OVERLAP = 10


class EmbeddingService:
    """Manages the vector store for a single repository."""

    def __init__(self):
        self.openai = OpenAI(api_key=settings.OPENAI_API_KEY)
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
        """Decides whether a file is worth embedding based on its extension."""
        lower = file_path.lower()
        return any(lower.endswith(ext) for ext in INDEXABLE_EXTENSIONS)

    @staticmethod
    def chunk_file(content: str, file_path: str) -> List[dict]:
        """
        Splits a source file into overlapping line-based chunks.
        Each chunk carries metadata about its position in the file.
        """
        lines = content.split("\n")
        chunks = []
        start = 0

        while start < len(lines):
            end = min(start + CHUNK_SIZE, len(lines))
            chunk_lines = lines[start:end]
            chunk_text = "\n".join(chunk_lines)

            # skip near-empty chunks
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

    # ── Embedding ─────────────────────────────────────────────────

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Batch-generate embeddings via OpenAI."""
        if not texts:
            return []

        # OpenAI supports batches of up to ~2048 in one call
        response = self.openai.embeddings.create(
            input=texts,
            model=settings.OPENAI_EMBEDDING_MODEL,
        )
        return [item.embedding for item in response.data]

    # ── Indexing ──────────────────────────────────────────────────

    def index_file(self, repo_id: int, file_path: str, content: str) -> int:
        """
        Chunks a file, embeds it, and upserts into ChromaDB.
        Returns the number of chunks stored.
        """
        chunks = self.chunk_file(content, file_path)
        if not chunks:
            return 0

        collection = self._get_or_create_collection(repo_id)

        texts = [c["text"] for c in chunks]
        ids = [c["id"] for c in chunks]
        metadatas = [c["metadata"] for c in chunks]

        # embed in batches of 100 to stay within API limits
        batch_size = 100
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
        """
        Finds the most relevant code chunks for a natural-language question.
        Returns a list of {text, metadata, relevance} dicts.
        """
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
                    "relevance": round(1 - dist, 4),  # cosine distance → similarity
                })

        return hits

    # ── Cleanup ───────────────────────────────────────────────────

    def delete_collection(self, repo_id: int):
        """Removes all vectors for a repository."""
        try:
            self.chroma.delete_collection(self._collection_name(repo_id))
            logger.info(f"Deleted vector collection for repo {repo_id}")
        except Exception as e:
            logger.warning(f"Could not delete collection for repo {repo_id}: {e}")
