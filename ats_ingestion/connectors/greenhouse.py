"""Greenhouse connector (startup ATS baseline)."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List
from urllib.parse import urlparse

from ..normalize import normalize_bool_remote
from ..schema import UnifiedJob
from .base import BaseConnector


class GreenhouseConnector(BaseConnector):
    source_system = "greenhouse"

    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        board = self._extract_board_token()
        endpoint = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true"
        response = self.http_client.request("GET", endpoint)
        records = self.parse_response(response.json())
        return self._apply_filters(records, keyword, location)

    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        if not isinstance(payload, dict):
            return []
        records: List[Dict[str, Any]] = []
        for job in payload.get("jobs", []):
            records.append(
                {
                    "job_id": str(job.get("id") or ""),
                    "title": job.get("title") or "",
                    "location": (job.get("location") or {}).get("name") or "",
                    "description": job.get("content") or "",
                    "posted_date": job.get("updated_at") or "",
                    "apply_url": job.get("absolute_url") or "",
                }
            )
        return records

    def normalize(self, records: Iterable[Dict[str, Any]]) -> List[UnifiedJob]:
        result: List[UnifiedJob] = []
        for r in records:
            location = r.get("location") or ""
            result.append(
                UnifiedJob(
                    job_id=str(r.get("job_id") or ""),
                    title=r.get("title") or "",
                    company=self.company_name,
                    location=location,
                    remote=normalize_bool_remote(location),
                    description=r.get("description") or "",
                    posted_date=r.get("posted_date") or "",
                    apply_url=r.get("apply_url") or "",
                    source_system=self.source_system,
                    employment_type="",
                    experience_level="",
                )
            )
        return result

    def _extract_board_token(self) -> str:
        parsed = urlparse(self.career_url)
        path = parsed.path.strip("/")
        if path.startswith("jobs/"):
            return path.split("/")[1]
        return parsed.netloc.split(".")[0]

    def _apply_filters(self, records: List[Dict[str, Any]], keyword: str, location: str) -> List[Dict[str, Any]]:
        filtered = records
        if keyword:
            key = keyword.lower()
            filtered = [r for r in filtered if key in (r.get("title") or "").lower()]
        if location:
            loc = location.lower()
            filtered = [r for r in filtered if loc in (r.get("location") or "").lower()]
        return filtered
