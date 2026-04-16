"""Tests for Hipp0Client — uses pytest-httpx for a real HTTP-layer mock."""

from __future__ import annotations

import pytest
from pytest_httpx import HTTPXMock

from openhipp0 import (
    Decision,
    Hipp0ApiError,
    Hipp0Client,
    Hipp0ConfigError,
)


@pytest.fixture
async def client() -> Hipp0Client:
    return Hipp0Client(base_url="http://hipp0.local", api_key="test-key")


async def test_client_rejects_empty_base_url() -> None:
    with pytest.raises(Hipp0ConfigError):
        Hipp0Client(base_url="")


async def test_decisions_create_posts_to_server(
    client: Hipp0Client, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://hipp0.local/api/decisions",
        json={
            "id": "d-1",
            "projectId": "demo",
            "title": "Use Postgres",
            "reasoning": "scale",
            "madeBy": "arch",
            "confidence": "high",
            "affects": [],
            "tags": ["infra"],
            "status": "active",
            "createdAt": "2026-04-16T00:00:00Z",
            "updatedAt": "2026-04-16T00:00:00Z",
        },
    )
    d = await client.decisions.create(
        project_id="demo",
        title="Use Postgres",
        reasoning="scale",
        made_by="arch",
        confidence="high",
        tags=["infra"],
    )
    assert isinstance(d, Decision)
    assert d.id == "d-1"
    assert d.tags == ["infra"]

    request = httpx_mock.get_request()
    assert request is not None
    assert request.headers["authorization"] == "Bearer test-key"


async def test_decisions_list_passes_filters(
    client: Hipp0Client, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        method="GET",
        url="http://hipp0.local/api/decisions?projectId=demo&limit=10&status=active",
        json=[],
    )
    rows = await client.decisions.list(project_id="demo", limit=10, status="active")
    assert rows == []


async def test_api_error_on_non_2xx(client: Hipp0Client, httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="http://hipp0.local/api/memory/stats",
        status_code=500,
        json={"message": "boom"},
    )
    with pytest.raises(Hipp0ApiError) as ei:
        await client.memory.stats()
    assert ei.value.status == 500


async def test_decisions_get_returns_none_on_404(
    client: Hipp0Client, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        method="GET",
        url="http://hipp0.local/api/decisions/missing",
        status_code=404,
        json={"message": "not found"},
    )
    d = await client.decisions.get("missing")
    assert d is None


async def test_health_check(client: Hipp0Client, httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="http://hipp0.local/health",
        json={"status": "ok", "checks": []},
    )
    report = await client.health.check()
    assert report.status == "ok"
