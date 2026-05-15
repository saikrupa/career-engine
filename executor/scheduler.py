from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from core.config import AppConfig
from executor.pipeline import JobAutomationPipeline
from utils.logging import get_logger

logger = get_logger("scheduler")


async def run_scheduler(config: AppConfig) -> None:
    pipeline = JobAutomationPipeline(config)
    interval_seconds = max(60, int(config.runtime.interval_minutes) * 60)
    logger.info("Scheduler started (interval=%ss)", interval_seconds)

    try:
        while True:
            started = datetime.now(timezone.utc)
            try:
                summary = await pipeline.run_once()
                logger.info("Iteration done at %s | %s", started.isoformat(), summary)
            except Exception as exc:
                logger.exception("Scheduler iteration failed: %s", exc)
            await asyncio.sleep(interval_seconds)
    finally:
        await pipeline.close()
