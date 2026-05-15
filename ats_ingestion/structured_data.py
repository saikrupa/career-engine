"""Structured data parser for schema.org JobPosting blocks."""

from __future__ import annotations

import json
from typing import Dict, List

from bs4 import BeautifulSoup


def extract_jobpostings_from_ld_json(html: str) -> List[Dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    jobs: List[Dict[str, str]] = []
    for script in soup.select('script[type="application/ld+json"]'):
        raw = script.string or script.get_text() or ""
        if not raw.strip():
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue

        candidates = payload if isinstance(payload, list) else [payload]
        for item in candidates:
            if not isinstance(item, dict):
                continue
            item_type = str(item.get("@type") or "")
            if item_type != "JobPosting":
                continue

            org = item.get("hiringOrganization") or {}
            loc = item.get("jobLocation") or {}
            address = loc.get("address") if isinstance(loc, dict) else {}

            jobs.append(
                {
                    "job_id": str(item.get("identifier") or item.get("url") or ""),
                    "title": str(item.get("title") or ""),
                    "company": str((org or {}).get("name") or ""),
                    "location": str((address or {}).get("addressLocality") or ""),
                    "description": str(item.get("description") or ""),
                    "posted_date": str(item.get("datePosted") or ""),
                    "apply_url": str(item.get("url") or ""),
                    "employment_type": str(item.get("employmentType") or ""),
                    "experience_level": "",
                }
            )
    return jobs
