from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import List

import requests

from core.models import Job
from sources.base import JobSource


class LeverSource(JobSource):
    name = "lever"

    async def fetch(self) -> List[Job]:
        company = self.config.get("company_slug")
        if not company:
            return []

        url = f"https://api.lever.co/v0/postings/{company}?mode=json"

        def _request() -> list:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            return resp.json()

        payload = await asyncio.to_thread(_request)
        jobs: List[Job] = []
        for item in payload:
            categories = item.get("categories") or {}
            jobs.append(
                Job(
                    id=str(item.get("id") or ""),
                    title=item.get("text") or "",
                    company=self.config.get("company", company),
                    location=categories.get("location") or "",
                    description=item.get("descriptionPlain") or "",
                    url=item.get("hostedUrl") or "",
                    source=self.name,
                    posted_time=str(item.get("createdAt") or datetime.now(timezone.utc).isoformat()),
                    easy_apply=False,
                )
            )
        return jobs
