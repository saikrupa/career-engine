"""Oracle Taleo connector with RSS-first strategy and HTML fallback."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any, Dict, Iterable, List
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..normalize import normalize_bool_remote
from ..schema import UnifiedJob
from .base import BaseConnector


class TaleoConnector(BaseConnector):
    source_system = "taleo"

    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        rss_candidates = [
            f"{self.career_url}/rss",
            f"{self.career_url}?rss=true",
        ]
        for rss_url in rss_candidates:
            try:
                response = self.http_client.request("GET", rss_url)
                records = self.parse_response(response.text)
                if records:
                    return self._apply_filters(records, keyword, location)
            except Exception:
                continue

        # HTML fallback
        response = self.http_client.request("GET", self.career_url)
        return self._apply_filters(self._parse_html(response.text), keyword, location)

    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        records: List[Dict[str, Any]] = []
        if not isinstance(payload, str):
            return records
        root = ET.fromstring(payload)
        channel = root.find("channel")
        if channel is None:
            return records
        for item in channel.findall("item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            description = (item.findtext("description") or "").strip()
            guid = (item.findtext("guid") or "").strip()
            location = self._extract_location_from_text(description)
            records.append(
                {
                    "job_id": guid or self._extract_req_id(link),
                    "title": title,
                    "location": location,
                    "description": description,
                    "apply_url": link,
                    "posted_date": (item.findtext("pubDate") or "").strip(),
                }
            )
        return records

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
                    employment_type="",
                    experience_level="",
                )
            )
        return jobs

    def _parse_html(self, html: str) -> List[Dict[str, Any]]:
        soup = BeautifulSoup(html, "html.parser")
        records: List[Dict[str, Any]] = []
        for anchor in soup.select("a[href]"):
            href = anchor.get("href") or ""
            text = anchor.get_text(" ", strip=True)
            if not text or "job" not in text.lower():
                continue
            records.append(
                {
                    "job_id": self._extract_req_id(href),
                    "title": text,
                    "location": "",
                    "description": "",
                    "apply_url": urljoin(self.career_url + "/", href),
                    "posted_date": "",
                }
            )
        return records

    def _extract_req_id(self, text: str) -> str:
        match = re.search(r"(?:req|requisition|job)(?:id)?[=/:_-]?([A-Za-z0-9-]{4,})", text, re.I)
        return match.group(1) if match else ""

    def _extract_location_from_text(self, text: str) -> str:
        match = re.search(r"location[:\s]+([^<\n]+)", text, re.I)
        return match.group(1).strip() if match else ""

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
