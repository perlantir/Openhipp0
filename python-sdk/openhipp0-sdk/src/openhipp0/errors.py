"""Error hierarchy — every SDK error is a Hipp0Error subclass."""

from __future__ import annotations


class Hipp0Error(Exception):
    """Base class — catch this to handle any SDK failure."""

    def __init__(self, message: str, code: str = "HIPP0_SDK_ERROR") -> None:
        super().__init__(message)
        self.code = code


class Hipp0ConfigError(Hipp0Error):
    """Invalid client configuration (missing base_url, bad api_key)."""

    def __init__(self, message: str) -> None:
        super().__init__(message, "HIPP0_SDK_CONFIG")


class Hipp0ApiError(Hipp0Error):
    """Non-2xx response from the server."""

    def __init__(self, status: int, message: str, *, payload: object | None = None) -> None:
        super().__init__(f"HTTP {status}: {message}", "HIPP0_SDK_API")
        self.status = status
        self.payload = payload
