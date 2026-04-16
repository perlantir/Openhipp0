"""
Hipp0CrewCallback — a CrewAI callback that records each task outcome.

CrewAI exposes `task_callback` and `step_callback` on its `Agent` and `Crew`
classes. We provide a standalone callable that users can pass into those
hooks; every completed task becomes a decision in the hipp0 decision graph.

The integration does NOT import crewai at import time so this package can
be installed alongside CrewAI-less environments without ModuleNotFoundError.
"""

from __future__ import annotations

import asyncio
from typing import Any

from openhipp0 import Hipp0Client


class Hipp0CrewCallback:
    """Call-and-forget callback for CrewAI Agent / Crew hooks."""

    def __init__(
        self,
        client: Hipp0Client,
        *,
        project_id: str = "default",
        agent_id: str = "crewai",
    ) -> None:
        self._client = client
        self._project_id = project_id
        self._agent_id = agent_id

    def __call__(self, output: Any) -> None:
        """CrewAI invokes this with a TaskOutput (or similar). Non-blocking."""
        payload = _summarize(output)
        # CrewAI's hook is sync; schedule the HTTP call on the running loop.
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No loop — best-effort fire under a fresh loop.
            asyncio.run(self._record(payload))
            return
        loop.create_task(self._record(payload))

    async def _record(self, payload: dict[str, Any]) -> None:
        try:
            await self._client.decisions.create(
                project_id=self._project_id,
                title=payload.get("title") or "CrewAI task complete",
                reasoning=payload.get("reasoning") or "(no rationale emitted)",
                made_by=self._agent_id,
                confidence="medium",
                tags=["crewai", "task"],
            )
        except Exception:  # noqa: BLE001 — instrumentation must not crash user code
            return


def instrument(client: Hipp0Client) -> Hipp0CrewCallback:
    """
    Hook CrewAI into hipp0. Returns the callback instance so the caller can
    pass it directly into `Crew(..., task_callback=cb)`.

    Because CrewAI's callback interface is attach-at-construction (not a
    process-wide global hook), this function cannot magically wire every
    existing Crew — it returns the callback for explicit installation.
    """
    return Hipp0CrewCallback(client)


def _summarize(output: Any) -> dict[str, Any]:
    """Best-effort extraction of a CrewAI TaskOutput or str."""
    if isinstance(output, str):
        return {"title": output[:100], "reasoning": output}
    title = getattr(output, "description", None) or getattr(output, "task", None)
    reasoning = getattr(output, "raw", None) or getattr(output, "result", None) or str(output)
    return {
        "title": str(title)[:200] if title else None,
        "reasoning": str(reasoning)[:2000] if reasoning else None,
    }
