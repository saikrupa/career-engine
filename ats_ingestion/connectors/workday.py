"""Workday connector with endpoint discovery and paginated job extraction."""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

from ..exceptions import ConnectorError
from ..normalize import normalize_bool_remote
from ..schema import UnifiedJob
from .base import BaseConnector


class WorkdayConnector(BaseConnector):
    source_system = "workday"

    def _discover_endpoint(self) -> Tuple[str, str]:
        """Build CXS jobs endpoint and tenant site from a Workday career URL."""
        parsed = urlparse(self.career_url)
        hostname = parsed.netloc
        path = parsed.path.strip("/")
        parts = [p for p in path.split("/") if p]

        # Typical format: /en-US/External or /External
        if parts and re.match(r"^[a-z]{2}-[A-Z]{2}$", parts[0]):
            parts = parts[1:]
        site = parts[0] if parts else "External"

        tenant = hostname.split(".")[0]
        endpoint = f"{parsed.scheme}://{hostname}/wday/cxs/{tenant}/{site}/jobs"
        return endpoint, site

    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        endpoint, _site = self._discover_endpoint()
        limit = 20
        offset = 0
        all_records: List[Dict[str, Any]] = []
        total: Optional[int] = None

        while total is None or offset < total:
            body = {
                "appliedFacets": {},
                "limit": limit,
                "offset": offset,
                "searchText": keyword,
            }
            response = self.http_client.request(
                "POST",
                endpoint,
                json_payload=body,
                headers={"Content-Type": "application/json"},
            )
            payload = response.json()
            page_records = self.parse_response(payload)
            if not page_records:
                break

            all_records.extend(page_records)
            total = int(payload.get("total") or len(all_records))
            offset += limit

        if location:
            loc_low = location.lower()
            all_records = [
                r for r in all_records if loc_low in (r.get("location") or "").lower()
            ]
        return all_records

    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        if not isinstance(payload, dict):
            raise ConnectorError("Unexpected Workday payload type")

        postings = payload.get("jobPostings") or []
        output: List[Dict[str, Any]] = []
        for posting in postings:
            title = posting.get("title") or ""
            posting_id = posting.get("bulletFields", [])
            location = self._extract_location(posting)
            external_path = posting.get("externalPath") or posting.get("externalUrl") or ""
            posted_date = posting.get("postedOn") or ""

            output.append(
                {
                    "job_id": self._extract_posting_id(posting_id, posting),
                    "title": title,
                    "location": location,
                    "posted_date": posted_date,
                    "external_path": external_path,
                    "description": posting.get("description") or "",
                    "raw": posting,
                }
            )
        return output

    def normalize(self, records: Iterable[Dict[str, Any]]) -> List[UnifiedJob]:
        jobs: List[UnifiedJob] = []
        for record in records:
            apply_url = self._build_apply_url(record.get("external_path", ""))
            location = record.get("location") or ""
            jobs.append(
                UnifiedJob(
                    job_id=str(record.get("job_id") or ""),
                    title=record.get("title") or "",
                    company=self.company_name or self._infer_company_name(),
                    location=location,
                    remote=normalize_bool_remote(location),
                    description=record.get("description") or "",
                    posted_date=record.get("posted_date") or "",
                    apply_url=apply_url,
                    source_system=self.source_system,
                    employment_type=self._extract_employment_type(record.get("raw", {})),
                    experience_level=self._extract_experience_level(record.get("raw", {})),
                )
            )
        return jobs

    def _build_apply_url(self, external_path: str) -> str:
        if external_path.startswith("http://") or external_path.startswith("https://"):
            return external_path
        return urljoin(self.career_url + "/", external_path.lstrip("/"))

    def _extract_location(self, posting: Dict[str, Any]) -> str:
        locations = posting.get("locationsText")
        if locations:
            return str(locations)

        bullet_fields = posting.get("bulletFields") or []
        if isinstance(bullet_fields, list):
            for item in bullet_fields:
                if isinstance(item, str) and ("," in item or "remote" in item.lower()):
                    return item

        locations_data = posting.get("locations") or posting.get("location")
        if isinstance(locations_data, list):
            joined = [str(loc.get("name") or loc.get("displayName") or "") for loc in locations_data]
            return ", ".join([part for part in joined if part])

        return ""

    def _extract_posting_id(self, bullet_fields: Any, posting: Dict[str, Any]) -> str:
        # Workday often includes requisition IDs in bulletFields such as "R12345".
        if isinstance(bullet_fields, list):
            for item in bullet_fields:
                if isinstance(item, str) and re.search(r"\b[A-Z]?\d{4,}\b", item):
                    return item.strip()
        return str(posting.get("id") or posting.get("jobPostingId") or "")

    def _extract_employment_type(self, raw: Dict[str, Any]) -> str:
        text = " ".join(str(x) for x in (raw.get("bulletFields") or []))
        for token in ("Full time", "Part time", "Contract", "Intern"):
            if token.lower() in text.lower():
                return token
        return ""

    def _extract_experience_level(self, raw: Dict[str, Any]) -> str:
        title = str(raw.get("title") or "").lower()
        if "senior" in title or "staff" in title or "principal" in title:
            return "Senior"
        if "lead" in title or "manager" in title:
            return "Lead"
        if "intern" in title or "junior" in title:
            return "Junior"
        return ""

    def _infer_company_name(self) -> str:
        hostname = urlparse(self.career_url).netloc
        return hostname.split(".")[0].replace("-", " ").title()
