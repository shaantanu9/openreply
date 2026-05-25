"""Runtime introspection — single-call snapshot of every queue/job
table the app uses, so the Task Manager screen can render in one
round-trip instead of fanning out 5+ invokes per refresh."""
from .snapshot import runtime_snapshot
from .explanations import get_explanation, list_explanations, set_explanation

__all__ = [
    "runtime_snapshot",
    "get_explanation",
    "list_explanations",
    "set_explanation",
]
