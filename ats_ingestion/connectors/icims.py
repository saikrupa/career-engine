"""iCIMS connector scaffold with a practical JSON-first strategy."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List

from ..normalize import normalize_bool_remote
from ..schema import UnifiedJob
from .base import BaseConnector


class IcimsConnector(BaseConnector):
    source_system = "icims"

    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        endpoint = self.career_url.rstrip("/") + "/jobs/search?mobile=false&width=1200"
        response = self.http_client.request("GET", endpoint)
        records = self.parse_response(response.json() if "json" in response.headers.get("Content-Type", "") else response.text)
        return self._apply_filters(records, keyword, location)

    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, dict):
            jobs = payload.get("jobs") or payload.get("items") or []
            records: List[Dict[str, Any]] = []
            for job in jobs:
                records.append(
                    {
                        "job_id": str(job.get("id") or ""),
                        "title": job.get("title") or "",
                        "location": job.get("location") or "",
                        "description": job.get("description") or "",
                        "posted_date": job.get("postedDate") or "",
                        "apply_url": job.get("url") or "",
                    }
                )
            return records
        return []

    def normalize(self, records: Iterable[Dict[str, Any]]) -> List[UnifiedJob]:
        output: List[UnifiedJob] = []
        for record in records:
            location = record.get("location") or ""
            output.append(
                UnifiedJob(
                    job_id=str(record.get("job_id") or ""),
                    title=record.get("title") or "",
                    company=self.company_name,
                    location=location,
                    remote=normalize_bool_remote(location),
                    description=record.get("description") or "",
                    posted_date=record.get("posted_date") or "",
                    apply_url=record.get("apply_url") or "",
                    source_system=self.source_system,
                    employment_type="",
                    experience_level="",
                )
            )
        return output

    def _apply_filters(
        self, records: List[Dict[str, Any]], keyword: str, location: str
    ) -> List[Dict[str, Any]]:
        filtered = records
        if keyword:
            key = keyword.lower()
            filtered = [r for r in filtered if key in (r.get("title") or "").lower()]
        if location:
            loc = location.lower()
            filtered = [r for r in filtered if loc in (r.get("location") or "").lower()]
        return filtered
