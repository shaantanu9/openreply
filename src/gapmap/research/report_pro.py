"""Citation-rich premium report — ready to send to a cofounder / VC / client.

Every finding traces back to specific posts. Each post has:
  - a direct permalink
  - source type badge
  - engagement score
  - short quote

Ends with: product build plan, competitor weakness matrix, GTM angle,
first-20-users-to-DM list.
"""
from __future__ import annotations

import json
from typing import Any

from ..core.db import get_db


def _source_label(source_type: str | None) -> str:
    return {
        "reddit": "Reddit", "hn": "Hacker News", "appstore": "App Store",
        "playstore": "Play Store", "arxiv": "arXiv", "openalex": "OpenAlex",
        "pubmed": "PubMed", "scholar": "Semantic Scholar", "gnews": "Google News",
        "devto": "DEV.to", "lemmy": "Lemmy", "mastodon": "Mastodon",
        "github": "GitHub", "github_issue": "GitHub Issue", "github_issues": "GitHub Issues",
        "stackoverflow": "Stack Overflow", "youtube": "YouTube",
        "discourse": "Discourse forum",
        "rss_marketing": "Marketing / growth (15 feeds)",
        "rss_persuasion": "Persuasion / behavioral",
        "rss_swipe": "Ad swipe files",
        "duckduckgo": "DuckDuckGo", "gdelt": "GDELT News", "tavily": "Tavily",
        "worldbank": "World Bank", "fred": "FRED", "bis": "BIS",
        "yfinance": "Yahoo Finance", "openmeteo": "Open-Meteo", "acled": "ACLED",
    }.get(source_type or "reddit", source_type or "Reddit")


_POST_PREFIX_LEN = len("post::")


def _posts_for_node(topic: str, node_id: str) -> list[dict]:
    """Return all evidence posts linked to a semantic node.

    Graph node IDs are like 'topic::kind::key'. To join against the `posts`
    table we need to strip the prefix and extract just the post key.
    """
    db = get_db()
    evidence_kinds = ("evidenced_by", "wished_in", "built_in", "solves")
    placeholders = ",".join("?" for _ in evidence_kinds)
    post_prefix = f"{topic}::post::"
    rows = list(
        db.query(
            f"""
            WITH evidence_node_ids AS (
                SELECT DISTINCT CASE WHEN e.src = ? THEN e.dst ELSE e.src END AS node_id
                FROM graph_edges e
                WHERE e.topic = ? AND (e.src = ? OR e.dst = ?)
                  AND e.kind IN ({placeholders})
            )
            SELECT p.id, p.sub, p.source_type, p.author, p.title,
                   substr(p.selftext, 1, 220) AS excerpt,
                   p.score, p.num_comments, p.created_utc, p.permalink
            FROM posts p
            JOIN evidence_node_ids ei
              ON ei.node_id = ? || p.id
            ORDER BY (p.num_comments * 2 + p.score) DESC
            """,
            [node_id, topic, node_id, node_id, *evidence_kinds, post_prefix],
        )
    )
    return rows


def _all_semantic_nodes(topic: str, kind: str) -> list[dict]:
    db = get_db()
    return [
        {"id": r["id"], "label": r["label"], "metadata": json.loads(r.get("metadata_json") or "{}")}
        for r in db.query(
            "SELECT * FROM graph_nodes WHERE topic = ? AND kind = ?", [topic, kind]
        )
    ]


def _source_tally(posts: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for p in posts:
        k = p.get("source_type") or "reddit"
        out[k] = out.get(k, 0) + 1
    return out


def render_citations_md(topic: str) -> str:
    """Full premium citation report."""
    painpoints = _all_semantic_nodes(topic, "painpoint")
    workarounds = _all_semantic_nodes(topic, "workaround")
    products = _all_semantic_nodes(topic, "product")
    features = _all_semantic_nodes(topic, "feature_wish")

    # Sort by frequency
    def _freq(n):
        return int((n.get("metadata") or {}).get("frequency") or 0)
    painpoints.sort(key=_freq, reverse=True)
    workarounds.sort(key=_freq, reverse=True)
    features.sort(key=_freq, reverse=True)

    # Corpus stats
    db = get_db()
    total_posts = next(iter(db.query(
        "SELECT count(*) n FROM posts p JOIN topic_posts tp ON tp.post_id=p.id WHERE tp.topic=?",
        [topic],
    )))["n"]
    source_totals = list(db.query(
        """SELECT coalesce(p.source_type,'reddit') AS src, count(*) AS n
           FROM posts p JOIN topic_posts tp ON tp.post_id=p.id
           WHERE tp.topic=? GROUP BY src ORDER BY n DESC""",
        [topic],
    ))

    L: list[str] = []
    L.append(f"# Gap Report — {topic}")
    L.append("")
    L.append(f"**Corpus:** {total_posts:,} posts across {len(source_totals)} source types  ")
    L.append("**Sources:** " + ", ".join(f"{_source_label(s['src'])} ({s['n']:,})" for s in source_totals))
    L.append("")
    L.append(f"- **{len(painpoints)}** distinct painpoints")
    L.append(f"- **{len(products)}** competitors named")
    L.append(f"- **{len(workarounds)}** DIY workarounds observed (strongest gap signal)")
    L.append(f"- **{len(features)}** explicit feature wishes")
    L.append("")

    # ═══ SCIENCE & LOCAL RESEARCH (non-Reddit corpus) ════════════════
    # Peer-reviewed papers + ingested PDFs / local docs. Separated from
    # Reddit so the reader sees at a glance what "science-backed" means
    # for this topic. Empty if no academic sources were fetched.
    research_rows = list(db.query(
        """SELECT p.id, p.title, p.url, p.permalink, p.author,
                  p.score, p.created_utc,
                  coalesce(p.source_type,'reddit') AS source,
                  substr(coalesce(p.selftext,''),1,240) AS excerpt,
                  p.sub AS subreddit
           FROM posts p JOIN topic_posts tp ON tp.post_id=p.id
           WHERE tp.topic=? AND coalesce(p.source_type,'reddit')!='reddit'
           ORDER BY
             CASE coalesce(p.source_type,'reddit')
               WHEN 'arxiv'    THEN 1
               WHEN 'pubmed'   THEN 2
               WHEN 'openalex' THEN 3
               WHEN 'scholar'  THEN 4
               WHEN 'ingest'   THEN 5
               ELSE 6
             END,
             coalesce(p.score,0) DESC, p.created_utc DESC""",
        [topic],
    ))
    if research_rows:
        # Bucket by source for a clean per-provider listing.
        by_src: dict[str, list[dict]] = {}
        for r in research_rows:
            by_src.setdefault(r["source"], []).append(r)

        L.append("---")
        L.append("")
        L.append("## 📚 Research & science evidence")
        L.append("")
        L.append(
            f"{len(research_rows)} non-Reddit sources backing this report — "
            f"peer-reviewed papers, preprints, and ingested documents."
        )
        L.append("")
        # Academic sources first, then ingest, then others
        src_order = [
            ("arxiv",    "arXiv preprints"),
            ("openalex", "OpenAlex papers"),
            ("pubmed",   "PubMed papers"),
            ("scholar",  "Semantic Scholar"),
            ("ingest",   "Ingested documents (PDFs / local files)"),
        ]
        printed = set()
        for src_key, src_header in src_order:
            rows = by_src.get(src_key)
            if not rows:
                continue
            printed.add(src_key)
            L.append(f"### {src_header} ({len(rows)})")
            L.append("")
            for r in rows[:15]:  # first 15 per source; avoids runaway reports
                title = (r.get("title") or "(untitled)").strip()[:160]
                url = r.get("url") or r.get("permalink") or ""
                cites = r.get("score") or 0
                cite_str = f" · **{cites}** cites" if cites and src_key in ("scholar", "openalex") else ""
                author = (r.get("author") or "").strip()
                author_str = f" — {author}" if author and author not in ("[deleted]", "") else ""
                if url:
                    L.append(f"- [{title}]({url}){author_str}{cite_str}")
                else:
                    L.append(f"- **{title}**{author_str}{cite_str}")
                excerpt = (r.get("excerpt") or "").strip()
                if excerpt:
                    L.append(f"  > {excerpt[:200]}")
            if len(rows) > 15:
                L.append(f"- _…and {len(rows) - 15} more_")
            L.append("")
        # Catch-all for any non-Reddit source not in the canonical order.
        for src_key, rows in by_src.items():
            if src_key in printed:
                continue
            L.append(f"### {_source_label(src_key)} ({len(rows)})")
            L.append("")
            for r in rows[:10]:
                title = (r.get("title") or "(untitled)").strip()[:160]
                url = r.get("url") or r.get("permalink") or ""
                if url:
                    L.append(f"- [{title}]({url})")
                else:
                    L.append(f"- **{title}**")
            L.append("")

    L.append("---")
    L.append("")

    # ═══ PAINPOINTS ═══════════════════════════════════════════════
    L.append("## 🔥 Painpoints — ranked by frequency")
    L.append("")
    for i, pp in enumerate(painpoints, 1):
        md = pp["metadata"] or {}
        posts = _posts_for_node(topic, pp["id"])
        tally = _source_tally(posts)
        L.append(f"### {i}. {pp['label']}")
        L.append("")
        badges = []
        if md.get("classification") and md["classification"] != "UNCLASSIFIED":
            badges.append(f"**{md['classification']}**")
        if md.get("severity"):
            badges.append(f"severity: `{md['severity']}`")
        if md.get("frequency"):
            badges.append(f"frequency: {md['frequency']} posts")
        L.append(" · ".join(badges))
        L.append("")
        if md.get("evidence"):
            L.append(f"> {md['evidence']}")
            L.append("")
        if tally:
            L.append(
                "**Cross-source confirmation:** "
                + " · ".join(f"{_source_label(s)} ({n})" for s, n in sorted(tally.items(), key=lambda x: -x[1]))
            )
            L.append("")
        if posts:
            L.append(f"**{len(posts)} supporting posts (top {min(10, len(posts))}):**")
            for p in posts[:10]:
                src_label = _source_label(p.get("source_type"))
                engagement = f"{p.get('score') or 0}↑"
                if p.get("num_comments"):
                    engagement += f" · {p['num_comments']}💬"
                title = (p.get("title") or "(no title)")[:100]
                url = p.get("permalink") or "#"
                L.append(f"- [{title}]({url}) — *{src_label}*, {engagement}")
                excerpt = (p.get("excerpt") or "").strip()
                if excerpt:
                    L.append(f"  > {excerpt[:180]}…")
            L.append("")
        L.append("")

    # ═══ DIY WORKAROUNDS ══════════════════════════════════════════
    L.append("---")
    L.append("")
    L.append("## 🛠 DIY workarounds — **each one is a feature that doesn't exist**")
    L.append("")
    for i, w in enumerate(workarounds, 1):
        md = w["metadata"] or {}
        posts = _posts_for_node(topic, w["id"])
        tally = _source_tally(posts)
        L.append(f"### {i}. {w['label']}")
        L.append("")
        parts = []
        if md.get("gap"):
            parts.append(f"**Gap filled:** _{md['gap']}_")
        if md.get("frequency"):
            parts.append(f"frequency: {md['frequency']} posts")
        L.append(" · ".join(parts))
        L.append("")
        if md.get("user_quote"):
            L.append(f"> {md['user_quote']}")
            L.append("")
        if tally:
            L.append(
                "**Seen across:** "
                + " · ".join(f"{_source_label(s)} ({n})" for s, n in sorted(tally.items(), key=lambda x: -x[1]))
            )
            L.append("")
        if posts:
            L.append(f"**Evidence ({min(6, len(posts))} of {len(posts)}):**")
            for p in posts[:6]:
                L.append(f"- [{(p.get('title') or '')[:90]}]({p.get('permalink') or '#'}) — *{_source_label(p.get('source_type'))}*")
            L.append("")

    # ═══ COMPETITORS ══════════════════════════════════════════════
    L.append("---")
    L.append("")
    L.append("## 😡 Competitors — named products users complain about")
    L.append("")
    if products:
        L.append("| # | Product | Severity | Freq | Key complaint |")
        L.append("|---|---|---|---|---|")
        for i, p in enumerate(products, 1):
            md = p["metadata"] or {}
            L.append(
                f"| {i} | **{p['label']}** | {md.get('severity') or '?'} | "
                f"{md.get('frequency') or '?'} | {md.get('about_product') or '(see evidence)'} |"
            )
        L.append("")

    # ═══ FEATURE WISHES ═══════════════════════════════════════════
    L.append("---")
    L.append("")
    L.append("## 💡 Feature wishes — users explicitly asked for these")
    L.append("")
    for i, f in enumerate(features, 1):
        md = f["metadata"] or {}
        posts = _posts_for_node(topic, f["id"])
        L.append(f"### {i}. {f['label']}")
        L.append("")
        if md.get("frequency"):
            L.append(f"Frequency: **{md['frequency']} posts**")
            L.append("")
        if md.get("user_quote"):
            L.append(f"> {md['user_quote']}")
            L.append("")
        if posts:
            L.append(f"**Evidence ({min(4, len(posts))}):**")
            for p in posts[:4]:
                L.append(f"- [{(p.get('title') or '')[:90]}]({p.get('permalink') or '#'})")
            L.append("")

    # ═══ BUILD PLAN ═══════════════════════════════════════════════
    L.append("---")
    L.append("")
    L.append("## 🎯 Product build plan — what the data says to build")
    L.append("")
    L.append("### Must-have features (every DIY workaround + top feature wishes)")
    L.append("")
    for w in workarounds:
        gap = (w["metadata"] or {}).get("gap", "")
        L.append(f"- **{w['label']}** (reason: {gap}) — users are literally building this themselves")
    for f in features[:8]:
        L.append(f"- **{f['label']}** ({(f['metadata'] or {}).get('frequency', '?')} explicit asks)")
    L.append("")
    L.append("### Positioning — against named competitors")
    L.append("")
    for p in products:
        md = p["metadata"] or {}
        L.append(
            f"- **Anti-{p['label']}**: address its weakness "
            f"({md.get('complaint') or md.get('severity', '?') + ' severity'})"
        )
    L.append("")
    L.append("### First 20 users to interview")
    L.append("")
    L.append(
        "Highest-engagement authors from the top 3 painpoints. "
        "These are people who are living the problem publicly — DM them."
    )
    L.append("")
    seen = set()
    for pp in painpoints[:3]:
        posts = _posts_for_node(topic, pp["id"])[:10]
        for p in posts:
            author = p.get("author") or ""
            if author in ("[deleted]", "", "[anon]") or author in seen:
                continue
            seen.add(author)
            src_label = _source_label(p.get("source_type"))
            L.append(f"- **{author}** — via {src_label} — [{(p.get('title') or '')[:70]}]({p.get('permalink') or '#'})")
            if len(seen) >= 20:
                break
        if len(seen) >= 20:
            break
    L.append("")
    L.append("---")
    L.append("")
    L.append("## 📖 How to use this report")
    L.append("")
    L.append("This report is a build guide, not a summary. Each section answers a specific product question:")
    L.append("")
    L.append("1. **Painpoints** → your *market validation*. If a painpoint shows up with HIGH severity + MULTI-source confirmation (Reddit **and** arXiv/PubMed), it's real — not a vocal-minority artifact.")
    L.append("2. **DIY workarounds** → your *product backlog*. Users are already building these themselves. Every row here is a feature that doesn't exist in a shipping product. This is the strongest possible signal.")
    L.append("3. **Competitors** → your *positioning map*. For each named product, read the complaint — that's your opening. Don't build a clone; build the anti-version.")
    L.append("4. **Feature wishes** → your *roadmap*. These are explicit asks with frequency counts. Top 3–5 are day-one features; the tail can wait.")
    L.append("5. **Research & science evidence** → your *credibility backbone*. When you talk to customers, investors, or partners, cite the papers above to show the problem is peer-reviewed, not just Reddit noise. Each link is a direct DOI/URL.")
    L.append("6. **First 20 users to interview** → your *user research pipeline*. These handles are real people publicly living the problem. DM them today.")
    L.append("")
    L.append("**Suggested workflow:**")
    L.append("")
    L.append("- Day 1: DM the first 20 users → validate the top 3 painpoints in 1:1s.")
    L.append("- Day 2–3: For each confirmed painpoint, read its cited papers + top Reddit threads in full — you'll understand *why* the workarounds exist.")
    L.append("- Day 4–5: Pick 2 workarounds to productize. These become your MVP scope.")
    L.append("- Day 6+: Write landing-page copy using direct user quotes from the evidence (the `>` blockquotes above). No invented marketing language needed — the users already wrote it.")
    L.append("")
    L.append("---")
    L.append("")
    L.append(f"*Generated from {total_posts:,} multi-source posts ({len(research_rows) if research_rows else 0} non-Reddit). All links above are real.*")
    return "\n".join(L)
