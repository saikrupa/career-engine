from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timezone
from typing import List

import requests

from core.models import Job
from sources.base import JobSource


class WorkdaySource(JobSource):
    name = "workday"

    async def fetch(self) -> List[Job]:
        endpoint = self.config.get("endpoint")
        company = self.config.get("company", "")
        if not endpoint:
            return []

        limit = int(self.config.get("limit", 20))
        offset = 0
        jobs: List[Job] = []
        total = None

        while total is None or offset < total:
            body = {
                "appliedFacets": {},
                "limit": limit,
                "offset": offset,
                "searchText": self.config.get("search", ""),
            }

            def _request() -> dict:
                resp = requests.post(endpoint, json=body, timeout=20)
                resp.raise_for_status()
                return resp.json()

            payload = await asyncio.to_thread(_request)
            postings = payload.get("jobPostings") or []
            if not postings:
                break

            for p in postings:
                title = p.get("title") or ""
                location = str(p.get("locationsText") or "")
                apply_url = self._to_url(p.get("externalPath") or p.get("externalUrl") or "")
                raw_id = str(p.get("id") or p.get("jobPostingId") or "").strip()
                if raw_id:
                    job_id = raw_id
                else:
                    seed = f"{title}|{location}|{apply_url}|{p.get('postedOn') or ''}"
                    job_id = hashlib.sha1(seed.encode("utf-8")).hexdigest()

                jobs.append(
                    Job(
                        id=job_id,
                        title=title,
                        company=company,
                        location=location,
                        description=p.get("description") or "",
                        url=apply_url,
                        source=self.name,
                        posted_time=p.get("postedOn") or datetime.now(timezone.utc).isoformat(),
                        easy_apply=True,
                    )
                )

            total = int(payload.get("total") or len(jobs))
            offset += limit

        return jobs

    def _to_url(self, external_path: str) -> str:
        base = self.config.get("base_url") or ""
        if external_path.startswith("http://") or external_path.startswith("https://"):
            return external_path
        if not base:
            return external_path
        return base.rstrip("/") + "/" + external_path.lstrip("/")
