"""Publish adapter contract + result type."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class PublishResult:
    ok: bool
    platform: str
    url: str = ""           # canonical URL of the first post
    ids: list = field(default_factory=list)   # remote ids, in post order
    parts: int = 0          # number of posts made (1 = single, >1 = thread)
    error: str = ""

    def to_dict(self) -> dict:
        return asdict(self)
