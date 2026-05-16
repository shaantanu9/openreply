# Contributing to Gap Map

Thank you for your interest in contributing. Gap Map is a local-first research tool and contributions are welcome in all forms — bug reports, documentation improvements, new data sources, and code.

---

## Quick start

```bash
git clone https://github.com/shaantanu9/gap-map-pro.git
cd gap-map-pro
uv sync --all-extras          # install everything including dev deps
uv run pytest tests/ -q       # run the test suite
```

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/).

---

## What to work on

Check the [open issues](https://github.com/shaantanu9/gap-map-pro/issues) — bugs labeled `good first issue` are the best entry point. If you have an idea not tracked yet, open an issue first so we can discuss before you invest time.

### High-value areas

- **New data sources** — add a source adapter in `src/reddit_research/sources/`. Each adapter is ~50 lines; follow the shape of `arxiv.py` or `hackernews.py`.
- **MCP tools** — new tools in `src/reddit_research/mcp/server.py` following the `@mcp.tool()` pattern.
- **Prompts** — improve any prompt in `prompts/*.yaml` without touching code.
- **Tests** — `tests/` is sparse. Any new test that covers a real behavior is welcome.
- **Docs** — fix errors, add examples, improve clarity in any `.md` file.

---

## Development workflow

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`
2. Make your changes. Keep commits focused and atomic.
3. Run checks before pushing:

```bash
uv run ruff check src/        # linting
uv run ruff format src/       # formatting
uv run pytest tests/ -q       # tests
python -m py_compile $(find src -name "*.py")   # syntax check
```

4. Open a pull request against `main`. Fill in the PR template.

---

## Adding a data source

Each source lives in `src/reddit_research/sources/<name>.py`. The file must export a `fetch_<name>(query, limit, **kwargs) -> list[dict]` function. Each returned row must match the `posts` table shape:

```python
{
    "id": str,          # unique — "sourcetype_nativeid"
    "sub": str,         # community/channel/category name
    "source_type": str, # e.g. "arxiv", "hackernews"
    "author": str,
    "title": str,
    "selftext": str,    # body / abstract (max 2000 chars)
    "url": str,
    "score": int,       # upvotes / citations / stars
    "upvote_ratio": float | None,
    "num_comments": int,
    "created_utc": float,  # unix timestamp
    "is_self": int,
    "over_18": int,
    "flair": str | None,
    "permalink": str,
    "fetched_at": str,  # ISO UTC
}
```

Then wire it into `src/reddit_research/sources/__init__.py` and add an `@mcp.tool()` entry in `src/reddit_research/mcp/server.py`. See `ARCHITECTURE.md` for the full data flow.

---

## Code style

- Python 3.11+, formatted with [ruff](https://docs.astral.sh/ruff/) (`line-length = 100`)
- No comments unless the WHY is non-obvious
- Local imports inside functions (matches existing pattern in `server.py`)
- Max ~400 lines per file — split if larger

---

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include:
- OS and Python version
- The exact command you ran
- Full error output (paste as text, not screenshot)

---

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.
