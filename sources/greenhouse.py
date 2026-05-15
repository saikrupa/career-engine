from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import List

import requests

from core.models import Job
from sources.base import JobSource


class GreenhouseSource(JobSource):
    name = "greenhouse"

    async def fetch(self) -> List[Job]:
        board = self.config.get("board")
        if not board:
            return []

        url = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true"

        def _request() -> dict:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            return resp.json()

        payload = await asyncio.to_thread(_request)
        jobs: List[Job] = []
        for item in payload.get("jobs", []):
            jobs.append(
                Job(
                    id=str(item.get("id") or ""),
                    title=item.get("title") or "",
                    company=(item.get("metadata") or {}).get("Company", "") or self.config.get("company", ""),
                    location=((item.get("location") or {}).get("name") or ""),
                    description=item.get("content") or "",
                    url=item.get("absolute_url") or "",
                    source=self.name,
                    posted_time=item.get("updated_at") or datetime.now(timezone.utc).isoformat(),
                    easy_apply=False,
                )
            )
        return jobs
