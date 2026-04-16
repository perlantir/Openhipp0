"""
AutoGen integration. Records each inter-agent message as a decision tagged
with the speaker's role so later trajectory replays can filter on it.
"""

from __future__ import annotations

from functools import partial
from typing import Any, Callable

from openhipp0 import Decision, Hipp0Client


async def record_message(
    client: Hipp0Client,
    *,
    project_id: str,
    speaker: str,
    content: Any,
    tags: list[str] | None = None,
) -> Decision:
    body = str(content)
    return await client.decisions.create(
        project_id=project_id,
        title=f"autogen: {speaker}",
        reasoning=body[:4000],
        made_by=speaker,
        confidence="low",
        tags=["autogen", *(tags or [])],
    )


def instrument(client: Hipp0Client) -> Callable[..., Any]:
    """Return a partial(record_message, client) for convenience."""
    return partial(record_message, client)
