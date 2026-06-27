"""Outbound publishing — post generated content to social platforms.

Mirror of the inbound `sources/` contract, but outbound: each adapter exposes
`publish(body, *, dry_run) -> PublishResult` and `plan(body) -> dict`.
Credentials live in the shared `source_credentials` table (core.credentials)
under a `<platform>_publish` source key. Adapters NEVER post without
credentials present — a missing credential returns a structured error, never
a silent or partial post.
"""
from .base import PublishResult

__all__ = ["PublishResult"]
