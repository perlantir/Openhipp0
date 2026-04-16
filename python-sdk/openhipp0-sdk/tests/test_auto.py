"""auto() should gracefully pick up installed integrations + skip missing ones."""

from __future__ import annotations

from openhipp0 import Hipp0Client, auto
from openhipp0.auto import _CANDIDATE_INTEGRATIONS


async def test_auto_returns_subset_of_known_integrations() -> None:
    """The list returned must be a subset of the candidate list — anything
    actually installed is hooked; anything missing is silently skipped."""
    async with Hipp0Client(base_url="http://localhost:3100") as client:
        result = auto(client=client)
    assert all(name in _CANDIDATE_INTEGRATIONS for name in result)


async def test_auto_constructs_default_client_without_explicit() -> None:
    """Calling auto() with no client must not raise even when HIPP0_BASE_URL is unset."""
    # Should not raise — it constructs a client targeting localhost:3100.
    result = auto()
    assert isinstance(result, list)
