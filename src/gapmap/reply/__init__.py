"""OpenReply — an open-source Reddit/social marketing co-pilot.

Find conversations worth replying to across many platforms (Reddit, X, LinkedIn,
HN, news, …), score each for relevance + buying intent + brand fit, and draft an
authentic, value-first reply in your brand voice. You review and post manually
(no auto-posting). BYOK LLM via the shared `analyze/providers` layer.

This package is purely the engine; the CLI lives in `gapmap.cli.reply_cmds`
(`gapmap reply ...`) and reuses the existing fetch, credentials, and DB layers.
"""
from . import brand, generate, opportunity, platforms, rules, schema  # noqa: F401

__all__ = ["brand", "generate", "opportunity", "platforms", "rules", "schema"]
