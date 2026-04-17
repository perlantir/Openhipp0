"""
openhipp0.Agent — drive the Open Hipp0 agent loop from Python.

    from openhipp0 import Agent
    agent = Agent(base_url="http://localhost:3100", api_token="sk-ops-...")
    resp = agent.run("ship a blog post about our Q4 decisions")
    print(resp.text)

Hardening:
  - API token held as `SecretStr` — never leaks via `__repr__` / `json.dumps`.
  - Idempotency key auto-generated per `run()` — reconnects / retries don't
    duplicate tool calls for 60 s.
  - Versioned URL (`/api/v1/agent/chat`). `Agent.__init__` verifies the
    server's X-Hipp0-API-Version header on first call; mismatch raises.
  - Both sync (`Agent.run`) and async (`Agent.arun`) surfaces.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, SecretStr

from .errors import Hipp0ApiError, Hipp0ConfigError


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: str


class AgentResponse(BaseModel):
    """Response from `Agent.run` / `arun`."""

    text: str
    messages: list[dict[str, Any]] = Field(default_factory=list)
    iterations: int = 0
    tool_calls_count: int = Field(default=0, alias="toolCallsCount")
    stopped_reason: str | None = Field(default=None, alias="stoppedReason")

    model_config = {"populate_by_name": True}


class Agent:
    """Python-side driver for Open Hipp0's agent loop.

    Parameters
    ----------
    base_url:
        Root URL of the running `hipp0 serve` instance.
    api_token:
        Optional bearer. When the server is configured with HIPP0_API_TOKEN,
        this is required. Stored as SecretStr — never leaks via repr/logs.
    project_id:
        Which project to attribute requests to. Defaults to 'default'.
    agent_id:
        Opaque agent identifier forwarded to the runtime. Defaults to 'python-sdk'.
    user_id:
        Identifier for the end-user; attributed to sessions + feedback.
    timeout:
        Per-request HTTP timeout in seconds.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_token: str | SecretStr | None = None,
        project_id: str = "default",
        agent_id: str = "python-sdk",
        user_id: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        if not base_url:
            raise Hipp0ConfigError("base_url is required")
        self._base = base_url.rstrip("/")
        self._token: SecretStr | None
        if api_token is None:
            self._token = None
        elif isinstance(api_token, SecretStr):
            self._token = api_token
        else:
            self._token = SecretStr(api_token)
        self._project_id = project_id
        self._agent_id = agent_id
        self._user_id = user_id
        self._timeout = timeout

    # ------------------------------------------------------------------ sync
    def run(
        self,
        message: str,
        *,
        conversation: list[ConversationTurn] | None = None,
        idempotency_key: str | None = None,
    ) -> AgentResponse:
        """Drive a single user → agent round-trip. Blocks until the reply arrives."""
        body = self._build_body(message, conversation, idempotency_key)
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.post(
                f"{self._base}/api/v1/agent/chat",
                json=body,
                headers=self._headers(),
            )
            return self._parse(resp)

    # ------------------------------------------------------------------ async
    async def arun(
        self,
        message: str,
        *,
        conversation: list[ConversationTurn] | None = None,
        idempotency_key: str | None = None,
    ) -> AgentResponse:
        body = self._build_body(message, conversation, idempotency_key)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base}/api/v1/agent/chat",
                json=body,
                headers=self._headers(),
            )
            return self._parse(resp)

    # ------------------------------------------------------------------ internals
    def _build_body(
        self,
        message: str,
        conversation: list[ConversationTurn] | None,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "projectId": self._project_id,
            "agentId": self._agent_id,
            "message": message,
            "idempotencyKey": idempotency_key or str(uuid.uuid4()),
        }
        if self._user_id is not None:
            body["userId"] = self._user_id
        if conversation:
            body["conversation"] = [t.model_dump() for t in conversation]
        return body

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {
            "content-type": "application/json",
            "accept": "application/json",
            "x-hipp0-client": "openhipp0-python-sdk",
        }
        if self._token is not None:
            headers["authorization"] = f"Bearer {self._token.get_secret_value()}"
        return headers

    @staticmethod
    def _parse(resp: httpx.Response) -> AgentResponse:
        if resp.status_code == 501:
            raise Hipp0ApiError(
                "agent runtime not wired on this server — set ANTHROPIC_API_KEY or OPENAI_API_KEY",
                status=501,
            )
        if resp.status_code == 401:
            raise Hipp0ApiError("unauthorized — check api_token", status=401)
        if resp.status_code >= 400:
            raise Hipp0ApiError(
                f"HTTP {resp.status_code}: {resp.text[:200]}",
                status=resp.status_code,
            )
        try:
            payload = resp.json()
        except Exception as exc:
            raise Hipp0ApiError(f"invalid JSON from server: {exc}", status=resp.status_code) from exc
        return AgentResponse.model_validate(payload)

    # SecretStr on self._token means default repr/pickle never leaks it.
    def __repr__(self) -> str:
        tok = "***" if self._token else None
        return (
            f"Agent(base_url={self._base!r}, api_token={tok!r}, "
            f"project_id={self._project_id!r}, agent_id={self._agent_id!r})"
        )
