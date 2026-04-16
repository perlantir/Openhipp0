"""Smoke-check pydantic model roundtrips."""

from __future__ import annotations

from openhipp0 import Decision, DecisionCreate, MemoryHit


def test_decision_create_defaults() -> None:
    d = DecisionCreate(
        project_id="p",
        title="t",
        reasoning="r",
        made_by="m",
    )
    assert d.confidence == "medium"
    assert d.affects == []
    assert d.tags == []


def test_decision_parses_server_response() -> None:
    d = Decision(
        id="id",
        project_id="p",
        title="t",
        reasoning="r",
        made_by="m",
        confidence="high",
        affects=["x"],
        tags=["y"],
        status="active",
        created_at="2026-04-16T00:00:00Z",
        updated_at="2026-04-16T00:00:00Z",
    )
    assert d.confidence == "high"


def test_memory_hit_model() -> None:
    m = MemoryHit(session_id="s", summary="done", rank=0.9)
    assert m.rank == 0.9
