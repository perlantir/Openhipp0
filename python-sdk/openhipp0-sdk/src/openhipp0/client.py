"""
Hipp0Client — async HTTP client for the Open Hipp0 HTTP API.

The server-side HTTP endpoints land in Phase 8.5's deployment layer; the
SDK is built against that contract so users can write code today.

    client = Hipp0Client(base_url="http://localhost:3100", api_key="sk-...")
    await client.decisions.create(...)
    await client.memory.search(project_id="demo", query="postgres")
    await client.health.check()
"""

from __future__ import annotations

from typing import Any

import httpx

from .errors import Hipp0ApiError, Hipp0ConfigError
from .types import Confidence, Decision, DecisionStatus, HealthReport, MemoryHit


class _BaseResource:
    def __init__(self, client: "Hipp0Client") -> None:
        self._client = client


class DecisionsAPI(_BaseResource):
    async def create(
        self,
        *,
        project_id: str,
        title: str,
        reasoning: str,
        made_by: str,
        confidence: Confidence = "medium",
        affects: list[str] | None = None,
        tags: list[str] | None = None,
    ) -> Decision:
        body = {
            "projectId": project_id,
            "title": title,
            "reasoning": reasoning,
            "madeBy": made_by,
            "confidence": confidence,
            "affects": affects or [],
            "tags": tags or [],
        }
        raw = await self._client._request("POST", "/api/decisions", json=body)
        return Decision.model_validate(_rekey_camel_to_snake(raw))

    async def list(
        self,
        *,
        project_id: str,
        status: DecisionStatus | None = None,
        limit: int = 50,
    ) -> list[Decision]:
        params: dict[str, Any] = {"projectId": project_id, "limit": limit}
        if status is not None:
            params["status"] = status
        raw = await self._client._request("GET", "/api/decisions", params=params)
        return [Decision.model_validate(_rekey_camel_to_snake(r)) for r in raw]

    async def get(self, decision_id: str) -> Decision | None:
        try:
            raw = await self._client._request("GET", f"/api/decisions/{decision_id}")
        except Hipp0ApiError as e:
            if e.status == 404:
                return None
            raise
        return Decision.model_validate(_rekey_camel_to_snake(raw))


class MemoryAPI(_BaseResource):
    async def search(
        self,
        *,
        project_id: str,
        query: str,
        limit: int = 10,
        agent_id: str | None = None,
        user_id: str | None = None,
    ) -> list[MemoryHit]:
        params: dict[str, Any] = {"projectId": project_id, "q": query, "limit": limit}
        if agent_id is not None:
            params["agentId"] = agent_id
        if user_id is not None:
            params["userId"] = user_id
        raw = await self._client._request("GET", "/api/memory/search", params=params)
        return [MemoryHit.model_validate(r) for r in raw]

    async def stats(self) -> dict[str, int]:
        return await self._client._request("GET", "/api/memory/stats")


class HealthAPI(_BaseResource):
    async def check(self) -> HealthReport:
        raw = await self._client._request("GET", "/health")
        return HealthReport.model_validate(raw)


class Hipp0Client:
    """Top-level client. All methods are async (run under asyncio)."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None = None,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not base_url:
            raise Hipp0ConfigError("base_url is required")
        headers = {"content-type": "application/json"}
        if api_key:
            headers["authorization"] = f"Bearer {api_key}"
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=timeout,
            transport=transport,
        )
        self.decisions = DecisionsAPI(self)
        self.memory = MemoryAPI(self)
        self.health = HealthAPI(self)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "Hipp0Client":
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.aclose()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        resp = await self._http.request(method, path, json=json, params=params)
        if 200 <= resp.status_code < 300:
            if resp.status_code == 204 or not resp.content:
                return None
            return resp.json()
        try:
            payload = resp.json()
            msg = payload.get("message") if isinstance(payload, dict) else resp.text
        except ValueError:
            payload = resp.text
            msg = resp.text
        raise Hipp0ApiError(resp.status_code, msg or resp.reason_phrase, payload=payload)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers


def _rekey_camel_to_snake(obj: Any) -> Any:
    """Server emits camelCase; pydantic models use snake_case."""
    if isinstance(obj, dict):
        return {_camel_to_snake(k): _rekey_camel_to_snake(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_rekey_camel_to_snake(v) for v in obj]
    return obj


def _camel_to_snake(s: str) -> str:
    out: list[str] = []
    for i, ch in enumerate(s):
        if ch.isupper() and i > 0:
            out.append("_")
        out.append(ch.lower())
    return "".join(out)
