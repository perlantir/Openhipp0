"""Retro-E — VoiceAPI, PushAPI, WidgetsAPI, PairingAPI, AuditAPI tests."""

from __future__ import annotations

import pytest
from pytest_httpx import HTTPXMock

from openhipp0 import Hipp0Client


@pytest.fixture
async def client() -> Hipp0Client:
    return Hipp0Client(base_url="http://hipp0.local", api_key="test-key")


async def test_voice_transcribe(client: Hipp0Client, httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://hipp0.local/api/voice/transcribe",
        json={"text": "hello world", "language": "en", "duration": 1.2},
    )
    out = await client.voice.transcribe(
        audio_base64="BASE64",
        mime_type="audio/m4a",
        filename="v.m4a",
        language="en",
    )
    assert out["text"] == "hello world"
    req = httpx_mock.get_request()
    assert req is not None
    assert b'"audioBase64":"BASE64"' in req.content


async def test_voice_synthesize(client: Hipp0Client, httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://hipp0.local/api/voice/synthesize",
        json={"audioBase64": "QUFB", "mimeType": "audio/mpeg"},
    )
    out = await client.voice.synthesize(text="hi", voice="nova", format="mp3")
    assert out["audioBase64"] == "QUFB"


async def test_push_register(client: Hipp0Client, httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://hipp0.local/api/push/register",
        json={"ok": True},
    )
    out = await client.push.register(
        device_id="dev-1",
        push_token="ExponentPushToken[xxx]",
        platform="ios",
    )
    assert out == {"ok": True}


async def test_widgets_snapshot(client: Hipp0Client, httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="http://hipp0.local/api/widgets",
        json={
            "agents": [{"id": "a", "name": "Claude", "status": "online", "pendingApprovals": 0}],
            "cost": {"today": 0.42, "week": 3.1, "month": 18.9, "currency": "USD"},
            "nextAutomation": {"id": "t1", "name": "Digest", "nextRunIso": "2026-04-17T13:00:00Z"},
        },
    )
    snap = await client.widgets.snapshot()
    assert snap["cost"]["currency"] == "USD"
    assert snap["nextAutomation"]["id"] == "t1"


async def test_pairing_issue_and_complete(
    client: Hipp0Client, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        method="POST",
        url="http://hipp0.local/api/pairing/issue",
        json={"pairingToken": "tok", "serverPublicKey": "pub", "expiresAt": 99999},
    )
    issued = await client.pairing.issue(ttl_ms=60000, connection_method="lan")
    assert issued["pairingToken"] == "tok"

    httpx_mock.add_response(
        method="POST",
        url="http://hipp0.local/api/pairing/complete",
        json={"deviceId": "dev-1", "serverPublicKey": "pub", "envelope": {"nonce": "n", "ciphertext": "c"}},
    )
    completed = await client.pairing.complete(
        pairing_token="tok",
        mobile_public_key="mobile-pub",
        device_name="test-phone",
        platform="ios",
    )
    assert completed["deviceId"] == "dev-1"


async def test_pairing_list_and_remove(
    client: Hipp0Client, httpx_mock: HTTPXMock
) -> None:
    httpx_mock.add_response(
        method="GET",
        url="http://hipp0.local/api/pairing/devices",
        json={"devices": [{"deviceId": "dev-1", "deviceName": "phone", "platform": "ios"}]},
    )
    devices = await client.pairing.list_devices()
    assert devices[0]["deviceId"] == "dev-1"

    httpx_mock.add_response(
        method="DELETE",
        url="http://hipp0.local/api/pairing/devices/dev-1",
        status_code=204,
    )
    await client.pairing.remove_device("dev-1")


async def test_audit_list_filters(client: Hipp0Client, httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        method="GET",
        url="http://hipp0.local/api/audit?limit=50&projectId=p1&agentId=claude",
        json={
            "events": [
                {
                    "id": "a1",
                    "projectId": "p1",
                    "agentId": "claude",
                    "action": "tool.execute",
                    "costUsd": 0.01,
                    "createdAt": "2026-04-16T12:00:00Z",
                }
            ]
        },
    )
    events = await client.audit.list(project_id="p1", agent_id="claude", limit=50)
    assert len(events) == 1
    assert events[0]["action"] == "tool.execute"
