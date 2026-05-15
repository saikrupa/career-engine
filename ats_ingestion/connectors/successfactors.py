"""SAP SuccessFactors connector with embedded JSON and endpoint fallback parsing."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List

from bs4 import BeautifulSoup

from ..normalize import normalize_bool_remote
from ..schema import UnifiedJob
from ..structured_data import extract_jobpostings_from_ld_json
from .base import BaseConnector


class SuccessFactorsConnector(BaseConnector):
    source_system = "successfactors"

    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        response = self.http_client.request("GET", self.career_url)
        html_records = self.parse_response(response.text)
        if html_records:
            return self._apply_filters(html_records, keyword, location)

        # Common dynamic endpoint pattern fallback.
        endpoint = self.career_url.rstrip("/") + "/jobs"
        api_response = self.http_client.request("GET", endpoint)
        return self._apply_filters(self.parse_response(api_response.text), keyword, location)

    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        if not isinstance(payload, str):
            return []

        records = self._parse_embedded_json(payload)
        if records:
            return records

        records = extract_jobpostings_from_ld_json(payload)
        if records:
            return records

        return self._parse_html_cards(payload)

    def normalize(self, records: Iterable[Dict[str, Any]]) -> List[UnifiedJob]:
        jobs: List[UnifiedJob] = []
        for record in records:
            location = record.get("location") or ""
            jobs.append(
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
                    employment_type=record.get("employment_type") or "",
                    experience_level=record.get("experience_level") or "",
                )
            )
        return jobs

    def _parse_embedded_json(self, html: str) -> List[Dict[str, Any]]:
        soup = BeautifulSoup(html, "html.parser")
        for script in soup.select("script"):
            content = script.string or script.get_text() or ""
            if "jobReqId" not in content and "jobTitle" not in content:
                continue
            json_candidate = self._extract_json_blob(content)
            if not json_candidate:
                continue
            try:
                parsed = json.loads(json_candidate)
            except json.JSONDecodeError:
                continue

            records: List[Dict[str, Any]] = []
            jobs = parsed.get("jobs") if isinstance(parsed, dict) else []
            if not isinstance(jobs, list):
                continue
            for job in jobs:
                records.append(
                    {
                        "job_id": str(job.get("jobReqId") or job.get("id") or ""),
                        "title": job.get("jobTitle") or job.get("title") or "",
                        "location": job.get("location") or "",
                        "description": job.get("description") or "",
                        "posted_date": job.get("postedDate") or "",
                        "apply_url": job.get("url") or "",
                        "employment_type": job.get("employmentType") or "",
                        "experience_level": job.get("careerLevel") or "",
                    }
                )
            if records:
                return records
        return []

    def _parse_html_cards(self, html: str) -> List[Dict[str, Any]]:
        soup = BeautifulSoup(html, "html.parser")
        records: List[Dict[str, Any]] = []
        for card in soup.select("a[href]"):
            title = card.get_text(" ", strip=True)
            href = card.get("href") or ""
            if not title or "job" not in title.lower():
                continue
            records.append(
                {
                    "job_id": "",
                    "title": title,
                    "location": "",
                    "description": "",
                    "posted_date": "",
                    "apply_url": href,
                    "employment_type": "",
                    "experience_level": "",
                }
            )
        return records

    def _extract_json_blob(self, text: str) -> str:
        match = re.search(r"(\{.*\})", text, flags=re.DOTALL)
        return match.group(1) if match else ""

    def _apply_filters(
        self, records: List[Dict[str, Any]], keyword: str, location: str
    ) -> List[Dict[str, Any]]:
        output = records
        if keyword:
            key = keyword.lower()
            output = [r for r in output if key in (r.get("title") or "").lower()]
        if location:
            loc = location.lower()
            output = [r for r in output if loc in (r.get("location") or "").lower()]
        return output
