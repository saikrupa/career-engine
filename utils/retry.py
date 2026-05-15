from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, TypeVar

T = TypeVar("T")


async def with_retry(
    fn: Callable[[], Awaitable[T]],
    attempts: int = 3,
    base_delay: float = 0.8,
) -> T:
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await fn()
        except Exception as exc:
            last_exc = exc
            if attempt < attempts:
                await asyncio.sleep(base_delay * (2 ** (attempt - 1)))
    raise last_exc or RuntimeError("Unknown retry failure")
