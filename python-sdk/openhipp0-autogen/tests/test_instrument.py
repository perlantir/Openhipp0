from __future__ import annotations

from pytest_httpx import HTTPXMock

from openhipp0 import Hipp0Client
from openhipp0_autogen import instrument, record_message


def _response() -> dict[str, object]:
    return {
        "id": "d",
        "projectId": "team",
        "title": "autogen: user",
        "reasoning": "msg",
        "madeBy": "user",
        "confidence": "low",
        "affects": [],
        "tags": ["autogen"],
        "status": "active",
        "createdAt": "x",
        "updatedAt": "x",
    }


async def test_record_message_posts(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST", url="http://hipp0.local/api/decisions", json=_response()
    )
    async with Hipp0Client(base_url="http://hipp0.local") as client:
        d = await record_message(client, project_id="team", speaker="user", content="hello")
    assert d.id == "d"


async def test_instrument_returns_partial(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST", url="http://hipp0.local/api/decisions", json=_response()
    )
    async with Hipp0Client(base_url="http://hipp0.local") as client:
        fn = instrument(client)
        d = await fn(project_id="team", speaker="user", content="hi")
    assert d.id == "d"
