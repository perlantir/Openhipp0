"""
Hipp0CallbackHandler — LangChain callback that records LLM/tool activity
into hipp0. The LangChain imports are lazy so the package works without
langchain installed (tests exercise the no-langchain path).
"""

from __future__ import annotations

import asyncio
from typing import Any

from openhipp0 import Hipp0Client


class Hipp0CallbackHandler:
    """
    Subset of the LangChain BaseCallbackHandler interface that matters to us.
    We implement only the events we actually record; LangChain invokes the
    rest via getattr and silently skips missing attributes.
    """

    # LangChain's raise_error flag decides whether a callback exception
    # bubbles; False is the safe default for instrumentation.
    raise_error: bool = False
    ignore_agent: bool = False
    ignore_chain: bool = False
    ignore_llm: bool = False

    def __init__(
        self,
        client: Hipp0Client,
        *,
        project_id: str = "default",
        agent_id: str = "langchain",
    ) -> None:
        self._client = client
        self._project_id = project_id
        self._agent_id = agent_id

    def on_chain_end(self, outputs: Any, **_kwargs: Any) -> None:
        title = "LangChain chain end"
        reasoning = _stringify(outputs)[:2000]
        self._fire(title, reasoning, ["langchain", "chain"])

    def on_tool_end(self, output: Any, **_kwargs: Any) -> None:
        title = "LangChain tool end"
        reasoning = _stringify(output)[:2000]
        self._fire(title, reasoning, ["langchain", "tool"])

    def on_agent_finish(self, finish: Any, **_kwargs: Any) -> None:
        title = "LangChain agent finish"
        reasoning = _stringify(getattr(finish, "return_values", finish))[:2000]
        self._fire(title, reasoning, ["langchain", "agent"])

    def _fire(self, title: str, reasoning: str, tags: list[str]) -> None:
        async def go() -> None:
            try:
                await self._client.decisions.create(
                    project_id=self._project_id,
                    title=title,
                    reasoning=reasoning,
                    made_by=self._agent_id,
                    confidence="medium",
                    tags=tags,
                )
            except Exception:  # noqa: BLE001
                return

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(go())
        except RuntimeError:
            # No running loop — schedule under a fresh one.
            asyncio.run(go())


def instrument(client: Hipp0Client) -> Hipp0CallbackHandler:
    """
    Return a callback handler. LangChain's runnable config accepts a list
    of handlers, so the caller plugs this in where appropriate.
    """
    return Hipp0CallbackHandler(client)


def _stringify(v: Any) -> str:
    if isinstance(v, str):
        return v
    try:
        import json

        return json.dumps(v, default=str, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        return str(v)
