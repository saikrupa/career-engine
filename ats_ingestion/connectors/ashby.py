"""Ashby connector baseline using public GraphQL endpoint when available."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List
from urllib.parse import urlparse

from ..normalize import normalize_bool_remote
from ..schema import UnifiedJob
from .base import BaseConnector


class AshbyConnector(BaseConnector):
    source_system = "ashby"

    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        org = self._extract_org_slug()
        endpoint = "https://jobs.ashbyhq.com/api/non-user-graphql"
        query = {
            "operationName": "ApiJobBoardWithTeams",
            "variables": {"organizationHostedJobsPageName": org},
            "query": "query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {\n"
            "  jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {\n"
            "    jobs { id title locationName employmentType updatedAt jobUrl }\n"
            "  }\n"
            "}",
        }
        response = self.http_client.request("POST", endpoint, json_payload=query)
        records = self.parse_response(response.json())
        return self._apply_filters(records, keyword, location)

    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        jobs_payload = ((data.get("jobBoardWithTeams") or {}).get("jobs") or [])
        records: List[Dict[str, Any]] = []
        for job in jobs_payload:
            records.append(
                {
                    "job_id": str(job.get("id") or ""),
                    "title": job.get("title") or "",
                    "location": job.get("locationName") or "",
                    "description": "",
                    "posted_date": job.get("updatedAt") or "",
                    "apply_url": job.get("jobUrl") or "",
                    "employment_type": job.get("employmentType") or "",
                }
            )
        return records

    def normalize(self, records: Iterable[Dict[str, Any]]) -> List[UnifiedJob]:
        output: List[UnifiedJob] = []
        for r in records:
            location = r.get("location") or ""
            output.append(
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
        return output

    def _extract_org_slug(self) -> str:
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
