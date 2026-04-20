"""Curated RSS/Atom feed catalog grouped by category.

These are high-signal feeds for startup / science / ML / product-thinking
topics. Users opt into one or more category buckets via the collect wizard
(source ids like `rss_startup`, `rss_ml`). Adding a new feed here makes it
immediately available — no adapter change needed.

Each entry is (name, url). `name` is used as the post author so the UI
can show "from <publication>".
"""
from __future__ import annotations

# Category → list[(publication_name, feed_url)]
CATALOG: dict[str, list[tuple[str, str]]] = {
    # Learning / indie-tech essays
    "learning": [
        ("Learn Letter", "https://learnletter.com/feed"),
        ("High Growth Engineer", "https://www.jordancutler.ca/feed"),
        ("Refactoring", "https://refactoring.fm/feed"),
        ("Pragmatic Engineer", "https://newsletter.pragmaticengineer.com/feed"),
        ("Exponential View", "https://www.exponentialview.co/feed"),
    ],
    # Startup / founder / essay
    "startup": [
        ("Paul Graham", "http://www.aaronsw.com/2002/feeds/pgessays.rss"),
        ("Andreessen Horowitz", "https://a16z.com/feed/"),
        ("First Round Review", "https://review.firstround.com/rss"),
        ("Lenny's Newsletter", "https://www.lennysnewsletter.com/feed"),
        ("Not Boring", "https://www.notboring.co/feed"),
        ("Stratechery", "https://stratechery.com/feed/"),
        ("Every", "https://every.to/feed.xml"),
        ("SaaStr", "https://www.saastr.com/feed/"),
        ("The Generalist", "https://www.generalist.com/feed"),
    ],
    # Tech news / general
    "tech_news": [
        ("Hacker News Front Page", "https://hnrss.org/frontpage"),
        ("TechCrunch", "https://techcrunch.com/feed/"),
        ("The Verge", "https://www.theverge.com/rss/index.xml"),
        ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
        ("MIT Technology Review", "https://www.technologyreview.com/feed/"),
    ],
    # Products / new launches
    "products": [
        ("Product Hunt", "https://www.producthunt.com/feed"),
        ("Indie Hackers", "https://www.indiehackers.com/feed.xml"),
        ("Betalist", "https://betalist.com/feed"),
    ],
    # Engineering blogs
    "engineering": [
        ("Netflix Tech Blog", "https://netflixtechblog.com/feed"),
        ("Uber Engineering", "https://eng.uber.com/feed/"),
        ("Stripe Blog", "https://stripe.com/blog/feed.rss"),
        ("GitHub Blog", "https://github.blog/feed/"),
        ("Cloudflare Blog", "https://blog.cloudflare.com/rss/"),
        ("Martin Fowler", "https://martinfowler.com/feed.atom"),
    ],
    # Machine learning / AI research
    "ml": [
        ("OpenAI Blog", "https://openai.com/blog/rss.xml"),
        ("Google AI Blog", "https://blog.google/technology/ai/rss/"),
        ("DeepMind Blog", "https://deepmind.com/blog/feed/basic/"),
        ("BAIR Blog", "https://bair.berkeley.edu/blog/feed.xml"),
        ("Distill", "https://distill.pub/rss.xml"),
        ("Gradient Flow", "https://gradientflow.com/feed/"),
        ("Hugging Face Blog", "https://huggingface.co/blog/feed.xml"),
        ("The Batch", "https://www.deeplearning.ai/the-batch/feed/"),
        ("Import AI", "https://importai.substack.com/feed"),
        ("Simon Willison", "https://simonwillison.net/atom/everything/"),
    ],
    # Design / UX
    "design": [
        ("Nielsen Norman Group", "https://www.nngroup.com/feed/rss/"),
        ("Smashing Magazine", "https://www.smashingmagazine.com/feed/"),
        ("UX Collective", "https://uxdesign.cc/feed"),
        ("A List Apart", "https://alistapart.com/main/feed/"),
    ],
    # Psychology / behavioral science
    "psychology": [
        ("Psyche Magazine", "https://psyche.co/feed"),
        ("Nesslabs", "https://nesslabs.com/feed"),
        ("Scott Alexander (ACX)", "https://www.astralcodexten.com/feed"),
    ],
    # Neuroscience
    "neuroscience": [
        ("Neuroscience News", "https://neurosciencenews.com/feed/"),
        ("Quanta Magazine", "https://www.quantamagazine.org/feed/"),
    ],
    # Science (general)
    "science": [
        ("Nature News", "https://www.nature.com/nature.rss"),
        ("Science Magazine", "https://www.science.org/rss/news_current.xml"),
        ("Scientific American", "https://www.scientificamerican.com/platform/syndication/rss/"),
        ("Ars Technica Science", "https://feeds.arstechnica.com/arstechnica/science"),
        ("New Scientist", "https://www.newscientist.com/feed/home/"),
    ],
    # Marketing / growth
    "marketing": [
        ("HubSpot Marketing Blog", "https://blog.hubspot.com/marketing/rss.xml"),
        ("CXL", "https://cxl.com/blog/feed/"),
        ("Growth.Design", "https://growth.design/feed.rss"),
    ],
}


# Category groups shown in the UI picker, with human-readable labels.
CATEGORY_LABELS: dict[str, str] = {
    "learning": "Learning / essays",
    "startup": "Startup / founder",
    "tech_news": "Tech news",
    "products": "Products / launches",
    "engineering": "Engineering blogs",
    "ml": "ML / AI research",
    "design": "Design / UX",
    "psychology": "Psychology",
    "neuroscience": "Neuroscience",
    "science": "Science (general)",
    "marketing": "Marketing / growth",
}


# Default categories when user enables "rss" without specifying which.
# Chosen for broad applicability across startup+science+ML topics.
DEFAULT_CATEGORIES: list[str] = [
    "startup",
    "tech_news",
    "products",
    "ml",
    "science",
]


def feeds_for_categories(categories: list[str] | None) -> list[tuple[str, str, str]]:
    """Return (category, name, url) triples for the requested categories.

    Falls back to DEFAULT_CATEGORIES if caller passes None/empty. Unknown
    categories are silently dropped so a typo doesn't blow up the collect.
    """
    cats = [c for c in (categories or DEFAULT_CATEGORIES) if c in CATALOG]
    if not cats:
        cats = DEFAULT_CATEGORIES
    out: list[tuple[str, str, str]] = []
    for cat in cats:
        for name, url in CATALOG.get(cat, []):
            out.append((cat, name, url))
    return out
