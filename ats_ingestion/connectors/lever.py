"""Lever connector (startup ATS baseline)."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List
from urllib.parse import urlparse

from ..normalize import normalize_bool_remote
from ..schema import UnifiedJob
from .base import BaseConnector


class LeverConnector(BaseConnector):
    source_system = "lever"

    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        company = self._extract_company_token()
        endpoint = f"https://api.lever.co/v0/postings/{company}?mode=json"
        response = self.http_client.request("GET", endpoint)
        records = self.parse_response(response.json())
        return self._apply_filters(records, keyword, location)

    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        if not isinstance(payload, list):
            return []
        records: List[Dict[str, Any]] = []
        for job in payload:
            records.append(
                {
                    "job_id": str(job.get("id") or ""),
                    "title": job.get("text") or "",
                    "location": (job.get("categories") or {}).get("location") or "",
                    "description": job.get("descriptionPlain") or "",
                    "posted_date": str(job.get("createdAt") or ""),
                    "apply_url": job.get("hostedUrl") or "",
                    "employment_type": (job.get("categories") or {}).get("commitment") or "",
                }
            )
        return records

    def normalize(self, records: Iterable[Dict[str, Any]]) -> List[UnifiedJob]:
        jobs: List[UnifiedJob] = []
        for r in records:
            location = r.get("location") or ""
            jobs.append(
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
                    employment_type=r.get("employment_type") or "",
                    experience_level="",
                )
            )
        return jobs

    def _extract_company_token(self) -> str:
        parsed = urlparse(self.career_url)
        path = parsed.path.strip("/")
        return path.split("/")[0] if path else parsed.netloc.split(".")[0]

    def _apply_filters(self, records: List[Dict[str, Any]], keyword: str, location: str) -> List[Dict[str, Any]]:
        filtered = records
        if keyword:
            key = keyword.lower()
            filtered = [r for r in filtered if key in (r.get("title") or "").lower()]
        if location:
            loc = location.lower()
            filtered = [r for r in filtered if loc in (r.get("location") or "").lower()]
        return filtered
