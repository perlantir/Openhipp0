"""
LangGraph instrumentation. Each graph checkpoint becomes a hipp0 decision
(title = node name, reasoning = serialized state).
"""

from __future__ import annotations

import json
from functools import partial
from typing import Any, Callable

from openhipp0 import Decision, Hipp0Client


async def record_checkpoint(
    client: Hipp0Client,
    *,
    project_id: str,
    node: str,
    state: Any,
    made_by: str = "langgraph",
) -> Decision:
    reasoning = _safe_json(state)
    return await client.decisions.create(
        project_id=project_id,
        title=f"checkpoint: {node}",
        reasoning=reasoning[:4000],
        made_by=made_by,
        confidence="medium",
        tags=["langgraph", "checkpoint", node],
    )


def instrument(client: Hipp0Client) -> Callable[..., Any]:
    """Return a partial of `record_checkpoint` with the client pre-bound."""
    return partial(record_checkpoint, client)


def _safe_json(state: Any) -> str:
    try:
        return json.dumps(state, default=str, ensure_ascii=False)
    except TypeError:
        return str(state)
