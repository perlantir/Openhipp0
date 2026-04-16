from __future__ import annotations

import pytest
from pytest_httpx import HTTPXMock

from openhipp0 import Hipp0Client
from openhipp0_langgraph import instrument, record_checkpoint


@pytest.fixture
def decision_response() -> dict[str, object]:
    return {
        "id": "d-1",
        "projectId": "g",
        "title": "checkpoint: plan",
        "reasoning": "{}",
        "madeBy": "langgraph",
        "confidence": "medium",
        "affects": [],
        "tags": ["langgraph", "checkpoint", "plan"],
        "status": "active",
        "createdAt": "x",
        "updatedAt": "x",
    }


async def test_record_checkpoint_posts(httpx_mock: HTTPXMock, decision_response: dict) -> None:
    httpx_mock.add_response(
        method="POST", url="http://hipp0.local/api/decisions", json=decision_response
    )
    async with Hipp0Client(base_url="http://hipp0.local") as client:
        d = await record_checkpoint(client, project_id="g", node="plan", state={"k": 1})
    assert d.id == "d-1"


async def test_instrument_returns_bound_partial(
    httpx_mock: HTTPXMock, decision_response: dict
) -> None:
    httpx_mock.add_response(
        method="POST", url="http://hipp0.local/api/decisions", json=decision_response
    )
    async with Hipp0Client(base_url="http://hipp0.local") as client:
        fn = instrument(client)
        d = await fn(project_id="g", node="plan", state="state")
    assert d.id == "d-1"
