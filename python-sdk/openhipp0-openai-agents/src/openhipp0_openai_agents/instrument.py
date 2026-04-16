"""
Hipp0TraceProcessor — subclass-compatible with `agents.tracing.TracingProcessor`
but imports are lazy so tests run without the Agents SDK installed.
"""

from __future__ import annotations

import asyncio
from typing import Any

from openhipp0 import Hipp0Client


class Hipp0TraceProcessor:
    """
    Minimal TraceProcessor that records each completed trace as a hipp0
    decision. Attach via:

        from agents import tracing
        tracing.add_trace_processor(Hipp0TraceProcessor(client))
    """

    def __init__(
        self,
        client: Hipp0Client,
        *,
        project_id: str = "default",
        agent_id: str = "openai-agents",
    ) -> None:
        self._client = client
        self._project_id = project_id
        self._agent_id = agent_id

    # The Agents SDK calls these four methods on a processor; we only need two.
    def on_trace_start(self, trace: Any) -> None:
        pass

    def on_trace_end(self, trace: Any) -> None:
        title = f"agents trace: {getattr(trace, 'name', 'unnamed')}"
        summary = _extract_summary(trace)
        self._fire(title, summary)

    def on_span_start(self, span: Any) -> None:
        pass

    def on_span_end(self, span: Any) -> None:
        pass

    def shutdown(self) -> None:
        pass

    def force_flush(self) -> None:
        pass

    def _fire(self, title: str, reasoning: str) -> None:
        async def go() -> None:
            try:
                await self._client.decisions.create(
                    project_id=self._project_id,
                    title=title,
                    reasoning=reasoning[:4000],
                    made_by=self._agent_id,
                    confidence="medium",
                    tags=["openai-agents", "trace"],
                )
            except Exception:  # noqa: BLE001
                return

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(go())
        except RuntimeError:
            asyncio.run(go())


def instrument(client: Hipp0Client) -> Hipp0TraceProcessor:
    """Return a processor that callers pass to `tracing.add_trace_processor`."""
    return Hipp0TraceProcessor(client)


def _extract_summary(trace: Any) -> str:
    for attr in ("summary", "result", "output", "final_output"):
        v = getattr(trace, attr, None)
        if v:
            return str(v)
    return str(trace)
