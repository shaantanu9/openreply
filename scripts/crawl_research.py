#!/usr/bin/env python3
"""OpenReply research crawler (crawl4ai). Renders JS/SPA sites that static fetch can't.

Usage:
  .venv/bin/python scripts/crawl_research.py <url> [<url> ...] [--out docs/research]

Writes <slug>.md per URL and prints a short preview + any hex colors found.
This is the standard way to do competitor/market research for OpenReply.
"""
import asyncio, re, sys, pathlib
from crawl4ai import AsyncWebCrawler

def slug(u): return re.sub(r'[^a-z0-9]+', '-', u.lower().split('//')[-1]).strip('-')[:60]

async def crawl(urls, out):
    out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    async with AsyncWebCrawler(headless=True, verbose=False) as c:
        for url in urls:
            try:
                r = await c.arun(url=url, magic=True, simulate_user=True, scan_full_page=True,
                                 delay_before_return_html=5.0, page_timeout=60000, wait_until="load")
                md = r.markdown or ""
                if len(md) < 200:  # fallback: strip tags from cleaned html
                    html = r.cleaned_html or r.html or ""
                    md = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()
                (out / f"{slug(url)}.md").write_text(md)
                colors = sorted(set(re.findall(r'#[0-9a-fA-F]{6}', r.html or "")))[:30]
                print(f"\n== {url}  success={r.success} chars={len(md)} ==")
                print("colors:", ", ".join(colors) or "(none)")
                print(md[:1000])
            except Exception as e:
                print(f"\n== {url} FAILED: {e} ==")

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = "docs/research"
    if "--out" in sys.argv: out = sys.argv[sys.argv.index("--out")+1]
    if not args: print(__doc__); sys.exit(1)
    asyncio.run(crawl(args, out))
