from __future__ import annotations

import asyncio
import time


class AsyncRateLimiter:
    def __init__(self, max_calls: int, period_seconds: float) -> None:
        self.max_calls = max_calls
        self.period_seconds = period_seconds
        self.calls: list[float] = []
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            self.calls = [c for c in self.calls if now - c < self.period_seconds]
            if len(self.calls) >= self.max_calls:
                sleep_for = self.period_seconds - (now - self.calls[0])
                if sleep_for > 0:
                    await asyncio.sleep(sleep_for)
            self.calls.append(time.monotonic())
