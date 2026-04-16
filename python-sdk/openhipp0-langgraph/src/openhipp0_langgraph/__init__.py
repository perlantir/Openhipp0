"""LangGraph integration for Open Hipp0.

LangGraph nodes call `record_checkpoint` (or use the pre-bound partial
returned by `instrument(client)`) to persist graph state + decisions
into hipp0 as the graph executes.
"""

from __future__ import annotations

__version__ = "0.0.0"

from .instrument import instrument, record_checkpoint

__all__ = ["instrument", "record_checkpoint", "__version__"]
