"""
openhipp0.auto() — one-line auto-instrumentation.

Attempts to import each `openhipp0_<framework>` package and calls its
`instrument(client)` hook. Missing packages are silently skipped so users can
install only the integrations they actually use.

Example:

    import openhipp0
    openhipp0.auto()

Or with an explicit client:

    import openhipp0
    client = openhipp0.Hipp0Client(base_url="http://localhost:3100")
    openhipp0.auto(client=client)
"""

from __future__ import annotations

import importlib
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .client import Hipp0Client


_CANDIDATE_INTEGRATIONS = (
    "openhipp0_crewai",
    "openhipp0_langgraph",
    "openhipp0_langchain",
    "openhipp0_autogen",
    "openhipp0_openai_agents",
)


def auto(client: "Hipp0Client | None" = None) -> list[str]:
    """Hook every installed framework integration.

    Returns the list of package names that were successfully instrumented.
    If `client` is None, the default client uses env vars:
      HIPP0_BASE_URL (default http://localhost:3100)
      HIPP0_API_KEY  (optional)
    """
    if client is None:
        from .client import Hipp0Client

        client = Hipp0Client(
            base_url=os.environ.get("HIPP0_BASE_URL", "http://localhost:3100"),
            api_key=os.environ.get("HIPP0_API_KEY"),
        )

    instrumented: list[str] = []
    for name in _CANDIDATE_INTEGRATIONS:
        try:
            mod = importlib.import_module(name)
        except ImportError:
            continue
        hook = getattr(mod, "instrument", None)
        if callable(hook):
            try:
                hook(client)
                instrumented.append(name)
            except Exception:  # noqa: BLE001 — integrations must not crash auto()
                # Silent by design — an integration's bug shouldn't disable others.
                continue
    return instrumented
