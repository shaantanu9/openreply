"""Deterministic peer-entity ("competitor / alternative") extraction from SERP text.

Ported from the last30days-skill `competitors.py`: fan out "X alternatives /
competitors / vs" web searches, then bag-of-phrases score capitalized
brand-shaped candidates across the result titles + snippets. No LLM, no API key
— just text mining over search results we already fetch for free.

This is the proper replacement for the AlternativeTo API, which Cloudflare
403-blocks unauthenticated clients.
"""
from __future__ import annotations

import re
from collections import Counter

# A "brand-shaped" token: starts uppercase OR is camelCase with a later capital.
# Catches "Anthropic", "OpenAI", "xAI", "iPhone", "eBay", "Notion", "ClickUp".
_BRAND_TOKEN = (
    r"(?:[A-Z][A-Za-z0-9&.\-]*"
    r"|[a-z][A-Za-z0-9&.\-]*[A-Z][A-Za-z0-9&.\-]*)"
)
_CAPITALIZED_PHRASE = re.compile(rf"\b{_BRAND_TOKEN}(?:\s+{_BRAND_TOKEN}){{0,3}}\b")

# Title-case listicle fillers / grammar / time noise. A candidate made ENTIRELY
# of these is rejected; one that merely contains one is kept.
_STOPWORD_TOKENS: frozenset[str] = frozenset(
    tok.lower()
    for tok in (
        "Top", "Best", "Worst", "Popular", "Leading", "Similar", "Alternatives",
        "Alternative", "Competitor", "Competitors", "vs", "Vs", "Versus",
        "Review", "Reviews", "Comparison", "Guide", "List", "Lists", "Full",
        "Complete", "Free", "Paid", "Tools", "Tool", "Options", "Rivals",
        "Rival", "Pick", "Picks", "Ranking", "Ranked", "Recommended",
        "The", "A", "An", "Of", "In", "For", "To", "With", "On", "At", "By",
        "From", "Is", "Are", "And", "Or", "But", "Than", "As", "This", "That",
        "These", "Those", "Our", "Your", "Their",
        "January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December",
        *(str(y) for y in range(2018, 2031)),
        "AI", "Apps", "App", "Software", "Platform", "Service", "Startups",
        "Companies", "Company", "Products", "Product", "Brands", "Brand",
        # Product-page tabs / SERP noise that reads as brand-shaped but isn't.
        "Compare", "Comparisons", "Features", "Feature", "Pricing", "Price",
        "Prices", "Plans", "Plan", "Templates", "Template", "Note", "Notes",
        "Notetaking", "Note-taking", "Docs", "Doc", "Document", "Documents",
        "Wiki", "Wikis", "Workspace", "Workspaces", "Manager", "Management",
        "Digital", "Project", "Projects", "Task", "Tasks", "Notebook",
        "Notebooks", "Database", "Databases", "More", "How", "What", "Why",
        "When", "Which", "Where", "Who", "Get", "Use", "Using", "Try",
        "Overview", "About", "Home", "Blog", "News", "Article", "Articles",
        "Download", "Sign", "Login", "Learn", "Read", "See", "Find", "Make",
        "Discover", "Switcher", "Quest", "Winner", "Winners", "Test", "Tests",
        "Clear", "Roundup", "Verdict", "Conclusion", "Summary", "Takeaway",
        "Ultimate", "Detailed", "Honest", "Real", "Better", "Cheaper", "Faster",
    )
)

# A candidate that looks like a bare domain (Thurrott.com, Cloudwards.net) is a
# publisher, not a peer product.
_DOMAIN_LIKE = re.compile(r"\.[a-z]{2,}$", re.IGNORECASE)


def _topic_tokens(topic: str) -> set[str]:
    return {t for t in re.findall(r"[A-Za-z0-9]+", topic.lower()) if t}


def _candidate_ok(candidate: str, topic_tokens: set[str]) -> bool:
    tokens = [t for t in re.findall(r"[A-Za-z0-9&.\-]+", candidate) if t]
    if not tokens:
        return False
    if _DOMAIN_LIKE.search(candidate):  # bare publisher domain, not a product
        return False
    if all(t.lower() in _STOPWORD_TOKENS for t in tokens):
        return False
    if {t.lower() for t in tokens} & topic_tokens:  # drop self / topic overlap
        return False
    if len(tokens) == 1 and len(tokens[0]) < 2:
        return False
    return True


def _normalize(candidate: str) -> str:
    return re.sub(r"\s+", " ", candidate).strip(".,;:!?'\"()[] ")


def _publisher_tokens(items: list[dict]) -> set[str]:
    """Lowercased tokens of result publishers/hosts (e.g. 'techrepublic', 'g2').

    Candidates matching a publisher name are almost always the SERP source, not
    a peer product, so we exclude them (kills 'TechRepublic', 'Goodcall', 'G2').
    """
    out: set[str] = set()
    for item in items:
        for field in (item.get("author"), item.get("sub")):
            for tok in re.findall(r"[A-Za-z0-9]+", str(field or "").lower()):
                if tok not in ("com", "www", "net", "org", "io", "co"):
                    out.add(tok)
    return out


def extract_peer_entities(items: list[dict], topic: str, limit: int = 20) -> list[str]:
    """Score brand-shaped candidates across SERP items; return top `limit`.

    `items` are row dicts with `title` and `selftext`/`snippet` keys. Ties break
    by first-seen order so output is deterministic.
    """
    topic_tokens = _topic_tokens(topic)
    publisher_tokens = _publisher_tokens(items)
    counts: Counter[str] = Counter()
    first_seen: dict[str, int] = {}
    canonical: dict[str, str] = {}
    order = 0
    for item in items:
        text = f"{item.get('title', '')} {item.get('selftext') or item.get('snippet') or ''}"
        for raw in _CAPITALIZED_PHRASE.findall(text):
            cand = _normalize(raw)
            if not _candidate_ok(cand, topic_tokens):
                continue
            # Drop candidates that are just the result's publisher/host.
            cand_toks = {t.lower() for t in re.findall(r"[A-Za-z0-9]+", cand)}
            if cand_toks and cand_toks <= publisher_tokens:
                continue
            key = cand.lower()
            if key not in canonical:
                canonical[key] = cand
                first_seen[key] = order
                order += 1
            counts[key] += 1
    ranked = sorted(counts.keys(), key=lambda k: (-counts[k], first_seen[k]))
    return [canonical[k] for k in ranked[:limit]]
