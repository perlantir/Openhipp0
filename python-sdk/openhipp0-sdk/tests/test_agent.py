"""Tests for the `Agent` Python SDK class."""

from __future__ import annotations

import json
import pytest
from pydantic import SecretStr

from openhipp0 import Agent, AgentResponse, ConversationTurn
from openhipp0.errors import Hipp0ApiError, Hipp0ConfigError


def test_agent_requires_base_url():
    with pytest.raises(Hipp0ConfigError):
        Agent(base_url="")


def test_agent_repr_does_not_leak_token():
    agent = Agent(base_url="http://localhost:3100", api_token="super-secret-token")
    r = repr(agent)
    assert "super-secret-token" not in r
    assert "***" in r


def test_secretstr_token_is_accepted():
    agent = Agent(base_url="http://localhost:3100", api_token=SecretStr("sk-abc"))
    assert "sk-abc" not in repr(agent)


def test_run_posts_the_right_body(httpx_mock):  # type: ignore[no-untyped-def]
    httpx_mock.add_response(
        url="http://localhost:3100/api/v1/agent/chat",
        json={"text": "hi back", "messages": [], "iterations": 1},
    )
    agent = Agent(base_url="http://localhost:3100", api_token="ops-token", project_id="p1")
    resp = agent.run("hello")
    assert isinstance(resp, AgentResponse)
    assert resp.text == "hi back"
    # Inspect the request payload.
    req = httpx_mock.get_requests()[0]
    assert req.headers.get("authorization") == "Bearer ops-token"
    body = json.loads(req.read())
    assert body["projectId"] == "p1"
    assert body["message"] == "hello"
    # Idempotency key auto-generated.
    assert "idempotencyKey" in body
    assert len(body["idempotencyKey"]) >= 32


def test_run_sends_conversation_history(httpx_mock):  # type: ignore[no-untyped-def]
    httpx_mock.add_response(
        url="http://localhost:3100/api/v1/agent/chat",
        json={"text": "got it", "messages": [], "iterations": 1},
    )
    agent = Agent(base_url="http://localhost:3100")
    resp = agent.run(
        "now build it",
        conversation=[
            ConversationTurn(role="user", content="plan a feature"),
            ConversationTurn(role="assistant", content="Here's the plan..."),
        ],
    )
    assert resp.text == "got it"
    body = json.loads(httpx_mock.get_requests()[0].read())
    assert len(body["conversation"]) == 2
    assert body["conversation"][0]["role"] == "user"


def test_run_with_explicit_idempotency_key(httpx_mock):  # type: ignore[no-untyped-def]
    httpx_mock.add_response(
        url="http://localhost:3100/api/v1/agent/chat",
        json={"text": "ok", "messages": [], "iterations": 1},
    )
    agent = Agent(base_url="http://localhost:3100")
    agent.run("x", idempotency_key="my-key-123")
    body = json.loads(httpx_mock.get_requests()[0].read())
    assert body["idempotencyKey"] == "my-key-123"


def test_501_raises_helpful_message(httpx_mock):  # type: ignore[no-untyped-def]
    httpx_mock.add_response(
        url="http://localhost:3100/api/v1/agent/chat",
        status_code=501,
        json={"error": "agent runtime not wired"},
    )
    agent = Agent(base_url="http://localhost:3100")
    with pytest.raises(Hipp0ApiError) as exc:
        agent.run("hi")
    assert exc.value.status == 501
    assert "API_KEY" in str(exc.value)


def test_401_raises_unauthorized(httpx_mock):  # type: ignore[no-untyped-def]
    httpx_mock.add_response(
        url="http://localhost:3100/api/v1/agent/chat",
        status_code=401,
        json={"error": "unauthorized"},
    )
    agent = Agent(base_url="http://localhost:3100", api_token="wrong")
    with pytest.raises(Hipp0ApiError) as exc:
        agent.run("hi")
    assert exc.value.status == 401


async def test_arun_is_async(httpx_mock):  # type: ignore[no-untyped-def]
    httpx_mock.add_response(
        url="http://localhost:3100/api/v1/agent/chat",
        json={"text": "async ok", "messages": [], "iterations": 1},
    )
    agent = Agent(base_url="http://localhost:3100")
    resp = await agent.arun("hi")
    assert resp.text == "async ok"
