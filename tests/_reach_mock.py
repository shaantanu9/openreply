"""Tiny helper for source tests: build a mock httpx.Response with a request
attached (httpx.Response.raise_for_status() needs `.request` even for 2xx)."""
from __future__ import annotations

import httpx


def resp(status: int = 200, *, json=None, text: str | None = None) -> httpx.Response:
    req = httpx.Request("GET", "https://example.test")
    if json is not None:
        return httpx.Response(status, json=json, request=req)
    return httpx.Response(status, text=text or "", request=req)
