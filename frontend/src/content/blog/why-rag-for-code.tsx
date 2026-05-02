import type { BlogPost } from "./index";
import * as B from "@/components/blog/prose";

export const whyRAGForCode: BlogPost = {
  slug: "why-rag-for-code",
  title: "Why RAG beats pure LLM for understanding codebases",
  description:
    "Context windows are big, but codebases are bigger. Here's why retrieval-augmented generation is the right architecture for code analysis, and the tradeoffs we made.",
  author: { name: "The RepoInsight team" },
  publishedAt: "2026-04-11",
  tags: ["engineering", "ai", "architecture", "rag"],
  readingTime: 6,
  content: () => (
    <>
      <B.Lead>
        &quot;Why don't you just paste the whole codebase into Claude's context?&quot; We get this question a lot. Here's why that doesn't work — and what we do instead.
      </B.Lead>

      <B.H2>Context is not free</B.H2>
      <B.P>
        Claude's context window is impressive — hundreds of thousands of tokens. But real codebases dwarf that. A medium Django monolith is a million tokens. A Kubernetes fork is ten million. Even when everything fits, paying for the full context on every query is wasteful — you don't need to load the entire auth subsystem to answer <B.Code>&quot;what does our README say about deployment?&quot;</B.Code>
      </B.P>
      <B.P>
        And even when it fits and cost doesn't matter, quality degrades. Models attend unevenly across long contexts — the &quot;lost in the middle&quot; problem. Relevant code buried in file 237 gets ignored while irrelevant boilerplate in file 1 gets weighted heavily. You end up with confidently-wrong answers about code the model technically &quot;saw&quot; but didn't really process.
      </B.P>

      <B.H2>RAG: retrieve the relevant slice</B.H2>
      <B.P>
        Retrieval-augmented generation (RAG) solves this by doing a search step first. When you ask a question, we don't send the whole repo to Claude — we send the 8-12 chunks most semantically similar to your question. Claude gets a focused, high-signal context window.
      </B.P>
      <B.P>The pipeline:</B.P>
      <B.OL>
        <B.LI>
          <B.Strong>Chunk</B.Strong> every file into overlapping 60-line windows. Overlap matters — a symbol referenced across a chunk boundary would otherwise be cut in half.
        </B.LI>
        <B.LI>
          <B.Strong>Embed</B.Strong> each chunk into a 384-dim vector using sentence-transformers (we use <B.Code>all-MiniLM-L6-v2</B.Code>, which runs locally with no API cost).
        </B.LI>
        <B.LI>
          <B.Strong>Store</B.Strong> vectors in ChromaDB, keyed by repo-id so queries scope cleanly.
        </B.LI>
        <B.LI>
          <B.Strong>Query</B.Strong>: embed the user's question, cosine-similarity against the chunks, take the top-k.
        </B.LI>
        <B.LI>
          <B.Strong>Generate</B.Strong>: send those chunks to Claude with an instruction to cite the file path and line range for every claim.
        </B.LI>
      </B.OL>

      <B.H2>What makes code RAG different from document RAG</B.H2>
      <B.P>
        Most RAG systems you've read about are tuned for prose — technical manuals, knowledge bases, wikis. Code is different in three ways that forced us to rethink the default patterns.
      </B.P>

      <B.H3>1. Structure matters more than prose</B.H3>
      <B.P>
        In a knowledge base, &quot;chunk by paragraph&quot; works fine. In code, paragraph boundaries are meaningless — chunking mid-function destroys the thing you're trying to retrieve. We chunk by line ranges with generous overlap so a function landing at the boundary still gets captured in full by the next chunk.
      </B.P>

      <B.H3>2. File paths carry meaning</B.H3>
      <B.P>
        A chunk from <B.Code>auth/oauth.py</B.Code> is semantically different from a chunk from <B.Code>tests/auth/test_oauth.py</B.Code>, even if the code looks identical. We encode file paths as metadata alongside the vector and surface them in answers — users can click the citation to jump to the exact file and line.
      </B.P>

      <B.H3>3. Semantic similarity ≠ lexical similarity</B.H3>
      <B.P>
        A user asks <B.Em>&quot;where do we handle login?&quot;</B.Em>. The code doesn't say &quot;login&quot; — it says <B.Code>authenticate</B.Code>, <B.Code>verify_credentials</B.Code>, <B.Code>jwt_issue</B.Code>. Pure keyword search misses this entirely. Embeddings bridge the gap: they map <B.Em>&quot;login&quot;</B.Em> and <B.Em>&quot;authenticate&quot;</B.Em> to nearby points in vector space, so the right chunks surface even without lexical matches.
      </B.P>

      <B.H2>The tradeoff: retrieval quality caps answer quality</B.H2>
      <B.Callout kind="warning" title="Garbage in, garbage out">
        <B.P>
          If the retrieval step surfaces the wrong chunks, no amount of LLM cleverness will save you. The most common failure mode for RAG systems isn't the LLM hallucinating — it's the retriever missing the actually-relevant code.
        </B.P>
      </B.Callout>
      <B.P>
        We mitigate this by (a) generous top-k (8-12 chunks, not 3), (b) chunk overlap so boundary cases still get covered, and (c) including filename-level hints in the retrieval step so questions like &quot;what does the Dockerfile do?&quot; route correctly even when the file itself is small and wouldn't otherwise score high.
      </B.P>

      <B.H2>Why not just full-context with a bigger model?</B.H2>
      <B.P>Context windows keep growing. Won't RAG be obsolete soon?</B.P>
      <B.P>
        Maybe eventually. But today, even with a 1M-token model, you'd still want retrieval for cost and latency reasons. Sending 800K tokens of code on every query to answer a simple question costs more and takes longer than retrieving 5K relevant tokens. The <B.Em>right</B.Em> architecture for most production use cases is a hybrid: retrieval as the default, full-context escape hatch for the rare cases that need it.
      </B.P>

      <B.Divider />

      <B.P>
        RepoInsight is <B.A href="/">free for public repositories</B.A>. Try it on a codebase you already know and see if the retrieval surfaces what you expect.
      </B.P>
    </>
  ),
};
