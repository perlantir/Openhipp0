from __future__ import annotations

import asyncio

from pytest_httpx import HTTPXMock

from openhipp0 import Hipp0Client
from openhipp0_langchain import Hipp0CallbackHandler, instrument


def _decision_body(title: str) -> dict[str, object]:
    return {
        "id": "d",
        "projectId": "default",
        "title": title,
        "reasoning": "ok",
        "madeBy": "langchain",
        "confidence": "medium",
        "affects": [],
        "tags": [],
        "status": "active",
        "createdAt": "x",
        "updatedAt": "x",
    }


async def test_on_chain_end_posts_a_decision(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://hipp0.local/api/decisions",
        json=_decision_body("LangChain chain end"),
    )
    async with Hipp0Client(base_url="http://hipp0.local") as client:
        h = Hipp0CallbackHandler(client)
        h.on_chain_end({"answer": 42})
        await asyncio.sleep(0.05)
    assert httpx_mock.get_request() is not None


async def test_instrument_returns_handler() -> None:
    async with Hipp0Client(base_url="http://hipp0.local") as client:
        h = instrument(client)
        assert isinstance(h, Hipp0CallbackHandler)


def test_on_tool_end_survives_no_event_loop() -> None:
    client = Hipp0Client(base_url="http://127.0.0.1:65535")
    h = Hipp0CallbackHandler(client)
    h.on_tool_end("never reached")  # must not raise
    asyncio.run(client.aclose())
