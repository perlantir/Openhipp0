"""
Pydantic models matching the @openhipp0/memory schema.

These are structural mirrors — the server side is TypeScript/Drizzle but the
over-the-wire shapes are JSON, so we just model them in pydantic.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Confidence = Literal["high", "medium", "low"]
DecisionStatus = Literal["active", "superseded", "rejected"]


class DecisionCreate(BaseModel):
    project_id: str
    title: str
    reasoning: str
    made_by: str
    confidence: Confidence = "medium"
    affects: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class Decision(BaseModel):
    id: str
    project_id: str
    title: str
    reasoning: str
    made_by: str
    confidence: Confidence
    affects: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    status: DecisionStatus = "active"
    created_at: str
    updated_at: str


class MemoryHit(BaseModel):
    session_id: str
    summary: str
    rank: float


class SessionRow(BaseModel):
    id: str
    project_id: str
    agent_id: str
    user_id: str | None = None
    summary: str
    tool_calls_count: int
    tokens_used: int
    cost_usd: float
    created_at: str


class HealthReport(BaseModel):
    status: Literal["ok", "warn", "fail"]
    checks: list[dict[str, object]]
