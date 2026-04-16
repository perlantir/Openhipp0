from __future__ import annotations

import asyncio

import pytest
from pytest_httpx import HTTPXMock

from openhipp0 import Hipp0Client
from openhipp0_crewai import Hipp0CrewCallback, instrument


async def test_instrument_returns_callback() -> None:
    client = Hipp0Client(base_url="http://hipp0.local")
    cb = instrument(client)
    assert isinstance(cb, Hipp0CrewCallback)
    await client.aclose()


async def test_callback_posts_a_decision(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://hipp0.local/api/decisions",
        json={
            "id": "d-1",
            "projectId": "default",
            "title": "task",
            "reasoning": "ok",
            "madeBy": "crewai",
            "confidence": "medium",
            "affects": [],
            "tags": ["crewai", "task"],
            "status": "active",
            "createdAt": "x",
            "updatedAt": "x",
        },
    )
    client = Hipp0Client(base_url="http://hipp0.local")
    cb = Hipp0CrewCallback(client)
    cb("shipped the feature")
    # Give the background task a turn to complete.
    await asyncio.sleep(0.05)
    req = httpx_mock.get_request()
    assert req is not None
    await client.aclose()


def test_callback_is_noop_without_event_loop() -> None:
    """
    Exercising the sync fallback path — when there's no running loop, the
    callback creates one via asyncio.run(). We use a short 404 to verify
    it swallowed the error rather than raising.
    """
    client = Hipp0Client(base_url="http://127.0.0.1:65535")  # nothing listens
    cb = Hipp0CrewCallback(client)
    cb("no-op")  # must not raise
    asyncio.run(client.aclose())
