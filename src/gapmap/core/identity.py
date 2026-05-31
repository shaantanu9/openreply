"""Single source of truth for project identity.

Change a value HERE and every User-Agent, HTTP-Referer header, exported-report
footer, and docs link picks it up — no more hunting hardcoded URLs across the
tree (which is exactly how the old `shaantanu98/reddit-myind` URL ended up in
three different files).

If you fork or rebrand: edit `GITHUB_ORG` / `GITHUB_REPO` / `HOMEPAGE_URL` and
you're done.
"""
from __future__ import annotations

import os

PROJECT_NAME = "gapmap"
GITHUB_ORG = "myind-ai"
GITHUB_REPO = "gapmap"
GITHUB_URL = f"https://github.com/{GITHUB_ORG}/{GITHUB_REPO}"
DOCS_METHODOLOGY_URL = f"{GITHUB_URL}/blob/main/docs/methodology.md"
HOMEPAGE_URL = "https://gapmap.myind.ai"

# Polite-API contact surfaced in the User-Agent `mailto:` (OpenAlex/arXiv/PubMed
# use it to reach the maintainer). Override per-deployment with GAPMAP_CONTACT.
CONTACT_EMAIL = os.getenv("GAPMAP_CONTACT", "shantanubombatkar2@gmail.com")
