"""CrewAI integration for Open Hipp0.

Exports `instrument(client)` — the hook `openhipp0.auto()` calls when
the user has this package installed. Subscribes to CrewAI's task events
and records each completed task as a decision + memory entry.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from openhipp0 import Hipp0Client

__version__ = "0.0.0"

from .instrument import Hipp0CrewCallback, instrument

__all__ = ["instrument", "Hipp0CrewCallback", "__version__"]
