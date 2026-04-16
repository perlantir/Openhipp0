from __future__ import annotations

import asyncio

from pytest_httpx import HTTPXMock

from openhipp0 import Hipp0Client
from openhipp0_openai_agents import Hipp0TraceProcessor, instrument


class _FakeTrace:
    def __init__(self, name: str, summary: str) -> None:
        self.name = name
        self.summary = summary


def _response() -> dict[str, object]:
    return {
        "id": "d",
        "projectId": "default",
        "title": "agents trace: foo",
        "reasoning": "done",
        "madeBy": "openai-agents",
        "confidence": "medium",
        "affects": [],
        "tags": ["openai-agents", "trace"],
        "status": "active",
        "createdAt": "x",
        "updatedAt": "x",
    }


async def test_on_trace_end_posts(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST", url="http://hipp0.local/api/decisions", json=_response()
    )
    async with Hipp0Client(base_url="http://hipp0.local") as client:
        p = Hipp0TraceProcessor(client)
        p.on_trace_end(_FakeTrace("foo", "done"))
        await asyncio.sleep(0.05)
    assert httpx_mock.get_request() is not None


async def test_instrument_returns_processor() -> None:
    async with Hipp0Client(base_url="http://hipp0.local") as client:
        p = instrument(client)
        assert isinstance(p, Hipp0TraceProcessor)
