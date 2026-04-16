"""
openhipp0 — Python SDK for Open Hipp0.

Usage:

    from openhipp0 import Hipp0Client
    client = Hipp0Client(base_url="http://localhost:3100")
    await client.decisions.create(...)

Or one-line auto-instrumentation:

    import openhipp0
    openhipp0.auto()          # hooks any installed framework integration
"""

from __future__ import annotations

__version__ = "0.0.0"

from .client import Hipp0Client
from .errors import Hipp0Error, Hipp0ApiError, Hipp0ConfigError
from .types import (
    Confidence,
    Decision,
    DecisionCreate,
    DecisionStatus,
    HealthReport,
    MemoryHit,
    SessionRow,
)
from .auto import auto

__all__ = [
    "Hipp0Client",
    "Hipp0Error",
    "Hipp0ApiError",
    "Hipp0ConfigError",
    "Confidence",
    "Decision",
    "DecisionCreate",
    "DecisionStatus",
    "HealthReport",
    "MemoryHit",
    "SessionRow",
    "auto",
    "__version__",
]
