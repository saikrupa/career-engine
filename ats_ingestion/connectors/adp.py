"""ADP Recruiting connector scaffold."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List

from ..schema import UnifiedJob
from .base import BaseConnector


class AdpConnector(BaseConnector):
    source_system = "adp"

    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        endpoint = self.career_url.rstrip("/") + "/api/jobs"
        response = self.http_client.request("GET", endpoint)
        payload = response.json() if "json" in response.headers.get("Content-Type", "") else {}
        return self.parse_response(payload)

    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, dict):
            return payload.get("jobs") or payload.get("openings") or []
        return []

    def normalize(self, records: Iterable[Dict[str, Any]]) -> List[UnifiedJob]:
        result: List[UnifiedJob] = []
        for r in records:
            result.append(
                UnifiedJob(
                    job_id=str(r.get("id") or r.get("requisitionId") or ""),
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
        return result
