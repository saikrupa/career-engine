"""UKG/UltiPro connector scaffold."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List

from ..schema import UnifiedJob
from .base import BaseConnector


class UkgConnector(BaseConnector):
    source_system = "ukg"

    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        # UKG deployments vary heavily. Start with JSON endpoints when available.
        endpoint = self.career_url.rstrip("/") + "/jobs"
        response = self.http_client.request("GET", endpoint)
        return self.parse_response(response.json() if "json" in response.headers.get("Content-Type", "") else {})

    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, dict):
            return payload.get("jobs") or payload.get("items") or []
        return []

    def normalize(self, records: Iterable[Dict[str, Any]]) -> List[UnifiedJob]:
        jobs: List[UnifiedJob] = []
        for r in records:
            jobs.append(
                UnifiedJob(
                    job_id=str(r.get("id") or ""),
                    title=r.get("title") or "",
                    company=self.company_name,
                    location=r.get("location") or "",
                    remote=False,
                    description=r.get("description") or "",
                    posted_date=r.get("postedDate") or "",
                    apply_url=r.get("url") or "",
                    source_system=self.source_system,
                    employment_type=r.get("employmentType") or "",
                    experience_level=r.get("experienceLevel") or "",
                )
            )
        return jobs
