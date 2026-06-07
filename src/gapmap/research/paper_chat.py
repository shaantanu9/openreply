"""Cited Q&A over the paper corpus — grounded on section-aware paper chunks.

The general topic chat (``research.chat``) grounds on the whole evidence corpus
(Reddit/HN/etc. posts + paper abstracts). This module is the *paper-native*
counterpart: it answers a question using the full-text **paper chunks** indexed
in the palace (Mempalace ChromaDB + MiniLM), so every answer is backed by the
actual body of the papers — Methods, Results, Limitations — not just abstracts.

Each retrieved chunk carries its ``post_id`` and canonical ``section`` name, so
the answer can cite "[2] Smith et al. (2023) — §Results". Citations are built
deterministically from the retrieved chunks (not invented by the LLM), and the
streaming variant appends a guaranteed ``## Sources`` block at the end.

Provider streaming + resolution is reused from ``research.chat.llm_dispatch`` so
this honours the same BYOK provider auto-resolution (anthropic / openai /
openrouter / groq / ollama / …) as the rest of the app.

Public API:
  * ``paper_qa(topic, question, ...)``         → one-shot dict {answer, citations}
  * ``paper_qa_stream(topic, question, ...)``  → Iterator[str] of tokens + Sources
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterator

from ..core.db import get_db

# Max chunks fed to the model. 10 × ~1000 chars ≈ 10k chars of grounding —
# comfortably inside every provider's context window while leaving room for a
# long answer. Tunable by callers that want a tighter/looser net.
_DEFAULT_K = 10
_CHUNK_PREVIEW_CHARS = 900

# Sections that are structurally part of a paper but carry little answerable
# signal — a bibliography or acknowledgements block can score very high on
# keyword overlap (it literally lists the query terms) yet contains no findings.
# We over-fetch and drop these so grounding stays on substantive prose.
_NOISE_SECTIONS = {
    "references", "reference", "bibliography",
    "acknowledgments", "acknowledgements",
    "appendix", "appendices", "supplementary",
}


def _year_of(created_utc: Any) -> str:
    """Best-effort 4-digit year from a unix ts (papers store created_utc)."""
    try:
        ts = int(created_utc)
        if ts <= 0:
            return ""
        return str(datetime.fromtimestamp(ts, tz=timezone.utc).year)
    except (TypeError, ValueError, OSError, OverflowError):
        return ""


def _short_author(author: str | None) -> str:
    """'Smith, John; Doe, Jane' → 'Smith et al.' — compact citation author."""
    a = (author or "").strip()
    if not a or a in ("[deleted]", "unknown"):
        return ""
    first = a.replace(";", ",").split(",")[0].strip()
    # If author looks like "First Last", keep the last token as the surname.
    parts = first.split()
    surname = parts[-1] if parts else first
    multi = (";" in a) or ("," in a and len(a.split(",")) > 2) or (" and " in a.lower())
    return f"{surname} et al." if multi else surname


def _paper_meta(post_ids: list[str]) -> dict[str, dict]:
    """Pull title/author/year/url/source for the cited papers in one query."""
    if not post_ids:
        return {}
    db = get_db()
    placeholders = ",".join(["?"] * len(post_ids))
    rows = list(db.query(
        f"SELECT id, title, author, created_utc, url, "
        f"coalesce(source_type,'') AS source_type "
        f"FROM posts WHERE id IN ({placeholders})",
        post_ids,
    ))
    out: dict[str, dict] = {}
    for r in rows:
        out[r["id"]] = {
            "post_id": r["id"],
            "title": (r["title"] or "Untitled").strip(),
            "author": _short_author(r["author"]),
            "year": _year_of(r["created_utc"]),
            "url": r["url"] or "",
            "source_type": r["source_type"] or "",
        }
    return out


def _retrieve_chunks(
    question: str,
    topic: str | None,
    *,
    k: int,
    section_filter: list[str] | None,
    post_id: str | None,
) -> dict:
    """Section-aware paper-chunk retrieval via the palace. Soft-fails to a
    skip dict the caller can surface as 'no paper knowledge yet'."""
    try:
        from ..retrieval import palace
    except Exception as e:  # pragma: no cover — chromadb absent
        return {"ok": False, "reason": f"palace import failed: {e}", "results": []}
    # Over-fetch so that dropping noise sections (references/appendix/etc.) still
    # leaves a full k of substantive chunks. If the caller pinned an explicit
    # section_filter we trust it and skip the noise drop.
    pull = k if section_filter else k + 8
    res = palace.search_paper_chunks(
        question, k=pull, topic=topic,
        section_filter=section_filter, post_id=post_id,
    )
    if section_filter:
        return res
    results = res.get("results") or []
    if results:
        substantive = [
            c for c in results
            if (c.get("section") or "").strip().lower() not in _NOISE_SECTIONS
        ]
        # Keep the noise-free set; but if EVERYTHING was noise (e.g. a paper that
        # only parsed into a references blob), fall back to the raw results so
        # the user still gets an answer rather than an empty one.
        res = dict(res)
        res["results"] = (substantive or results)[:k]
        res["count"] = len(res["results"])
    return res


def _build_context(chunks: list[dict]) -> tuple[str, list[dict]]:
    """Turn retrieved chunks into (numbered_context_block, citations).

    One citation per distinct paper; a paper hit in several sections lists all
    the sections it contributed. The context block numbers each *paper* `[N]`
    and tags each quoted chunk with its section so the model can attribute a
    claim to the right part of the paper.
    """
    meta = _paper_meta(sorted({c.get("post_id", "") for c in chunks if c.get("post_id")}))

    # Assign a stable citation number per paper, ordered by first appearance
    # (chunks already arrive best-first).
    order: list[str] = []
    for c in chunks:
        pid = c.get("post_id", "")
        if pid and pid not in order:
            order.append(pid)
    num_of = {pid: i + 1 for i, pid in enumerate(order)}

    lines: list[str] = []
    sections_by_paper: dict[str, list[str]] = {}
    for c in chunks:
        pid = c.get("post_id", "")
        if not pid:
            continue
        n = num_of[pid]
        m = meta.get(pid, {})
        sec = (c.get("section") or "body").strip() or "body"
        sections_by_paper.setdefault(pid, [])
        if sec not in sections_by_paper[pid]:
            sections_by_paper[pid].append(sec)
        title = m.get("title", "Untitled")
        byline = " ".join(x for x in [m.get("author", ""), f"({m['year']})" if m.get("year") else ""] if x)
        head = f"[{n}] {title}" + (f" — {byline}" if byline else "") + f" · §{sec}"
        body = (c.get("text") or "").strip()[:_CHUNK_PREVIEW_CHARS]
        lines.append(f"{head}\n{body}")

    citations: list[dict] = []
    for pid in order:
        m = meta.get(pid, {})
        citations.append({
            "n": num_of[pid],
            "post_id": pid,
            "title": m.get("title", "Untitled"),
            "author": m.get("author", ""),
            "year": m.get("year", ""),
            "url": m.get("url", ""),
            "source_type": m.get("source_type", ""),
            "sections": sections_by_paper.get(pid, []),
        })
    return "\n\n".join(lines), citations


def _system_prompt() -> str:
    return (
        "You are a meticulous research assistant answering questions about a set "
        "of academic papers. You are given numbered excerpts from the papers' "
        "full text, each tagged with the paper number [N] and the section it came "
        "from (e.g. §Methods, §Results).\n\n"
        "Rules:\n"
        "1. Answer ONLY from the provided excerpts. If they don't contain the "
        "answer, say so plainly — do not draw on outside knowledge.\n"
        "2. Cite the supporting paper inline with its bracket number, e.g. "
        "'binaural beats raised theta power [2]'. Cite the section when it "
        "sharpens the claim, e.g. '[2, §Results]'.\n"
        "3. Never invent citation numbers — only use the [N] markers present in "
        "the excerpts.\n"
        "4. Be specific and quantitative when the excerpts are. Prefer the "
        "papers' own terms over paraphrase when precision matters.\n"
        "5. Do NOT append your own Sources/References list — one is added for you."
    )


def _user_prompt(question: str, context: str) -> str:
    return (
        f"Paper excerpts:\n\n{context}\n\n"
        f"---\nQuestion: {question}\n\n"
        "Answer using only the excerpts above, citing [N] inline."
    )


def _format_sources_block(citations: list[dict]) -> str:
    if not citations:
        return ""
    lines = ["\n\n## Sources"]
    for c in citations:
        byline = " ".join(x for x in [c.get("author", ""), f"({c['year']})" if c.get("year") else ""] if x)
        secs = ", ".join(f"§{s}" for s in c.get("sections", [])) if c.get("sections") else ""
        tail = " — ".join(x for x in [byline, secs] if x)
        title = c.get("title", "Untitled")
        if c.get("url"):
            entry = f"[{c['n']}] [{title}]({c['url']})"
        else:
            entry = f"[{c['n']}] {title}"
        if tail:
            entry += f" — {tail}"
        lines.append(entry)
    return "\n".join(lines)


def _no_knowledge_message(reason: str | None) -> str:
    base = (
        "I don't have any indexed paper full-text to answer from yet. "
        "Find papers for this topic, fetch their full text, and build paper "
        "knowledge first (Papers tab → Build paper knowledge, or "
        "`gapmap research paper-chunk --topic \"<topic>\"`)."
    )
    if reason:
        return f"{base}\n\n_(retrieval note: {reason})_"
    return base


# ─── Public API ────────────────────────────────────────────────────────────
def paper_qa(
    topic: str,
    question: str,
    *,
    provider: str | None = None,
    k: int = _DEFAULT_K,
    section_filter: list[str] | None = None,
    post_id: str | None = None,
    max_tokens: int = 1500,
) -> dict[str, Any]:
    """One-shot cited Q&A over paper chunks. Returns:

    ``{ok, answer, citations, used_chunks, provider, model}`` — or
    ``{ok: False, answer: <guidance>, citations: []}`` when no chunks exist.
    """
    chunks_res = _retrieve_chunks(
        question, topic, k=k, section_filter=section_filter, post_id=post_id,
    )
    chunks = chunks_res.get("results") or []
    if not chunks:
        reason = chunks_res.get("reason") or chunks_res.get("skipped_reason")
        return {
            "ok": False, "answer": _no_knowledge_message(reason),
            "citations": [], "used_chunks": 0,
            "reason": reason or "no_paper_chunks",
        }

    context, citations = _build_context(chunks)
    from .chat.llm_dispatch import _resolve_provider, stream_for_provider
    prov, model = _resolve_provider(provider)
    parts: list[str] = []
    for tok in stream_for_provider(
        prov, model, _system_prompt(), _user_prompt(question, context), max_tokens,
    ):
        parts.append(tok)
    answer = "".join(parts).strip()
    return {
        "ok": True,
        "answer": answer,
        "citations": citations,
        "used_chunks": len(chunks),
        "provider": prov,
        "model": model,
        "sources_markdown": _format_sources_block(citations),
    }


def paper_qa_stream(
    topic: str,
    question: str,
    *,
    provider: str | None = None,
    k: int = _DEFAULT_K,
    section_filter: list[str] | None = None,
    post_id: str | None = None,
    max_tokens: int = 1500,
) -> Iterator[str]:
    """Streaming cited Q&A. Yields answer tokens, then a deterministic
    ``## Sources`` block. Mirrors ``research.chat.chat_stream`` semantics so a
    UI can render it the same way."""
    chunks_res = _retrieve_chunks(
        question, topic, k=k, section_filter=section_filter, post_id=post_id,
    )
    chunks = chunks_res.get("results") or []
    if not chunks:
        yield _no_knowledge_message(
            chunks_res.get("reason") or chunks_res.get("skipped_reason")
        )
        return

    context, citations = _build_context(chunks)
    from .chat.llm_dispatch import _resolve_provider, stream_for_provider
    prov, model = _resolve_provider(provider)
    yield from stream_for_provider(
        prov, model, _system_prompt(), _user_prompt(question, context), max_tokens,
    )
    block = _format_sources_block(citations)
    if block:
        yield block


__all__ = ["paper_qa", "paper_qa_stream"]
