from __future__ import annotations

import asyncio
from typing import List

from core.models import Job
from sources.factory import build_sources
from utils.logging import get_logger
from utils.retry import with_retry

logger = get_logger("sources-runner")


async def fetch_all_sources(
    source_config: dict,
    max_parallel: int,
    timeout_seconds: int,
) -> List[Job]:
    sources = build_sources(source_config)
    if not sources:
        return []

    semaphore = asyncio.Semaphore(max_parallel)

    async def _fetch(source) -> List[Job]:
        async with semaphore:
            async def _op() -> List[Job]:
                logger.info("Fetching source=%s", source.name)
                return await asyncio.wait_for(source.fetch(), timeout=timeout_seconds)

            try:
                jobs = await with_retry(_op, attempts=3, base_delay=1.0)
                logger.info("Fetched %s jobs from %s", len(jobs), source.name)
                return jobs
            except Exception as exc:
                logger.warning("Source %s failed: %s", source.name, exc)
                return []

    results = await asyncio.gather(*[_fetch(s) for s in sources])

    flat: List[Job] = []
    for chunk in results:
        flat.extend(chunk)
    return flat
