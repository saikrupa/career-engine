"""Generic HTML fallback scraper for unknown ATS systems.

Used when detect_ats() cannot identify the platform. It fetches the careers page,
extracts every link that looks like a job posting (using heuristics and
schema.org JobPosting ld+json blocks), and returns a minimal list of UnifiedJob
objects so the pipeline can still emit something useful.
"""

from __future__ import annotations

import re
from typing import List
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .http_client import ResilientHttpClient
from .normalize import normalize_bool_remote
from .schema import UnifiedJob
from .structured_data import extract_jobpostings_from_ld_json

# Anchor text / href tokens that suggest a job link
_JOB_LINK_HINTS = re.compile(
    r"job|career|position|role|opening|engineer|developer|manager|analyst|designer|"
    r"recruiter|internship|vacancy|requisition",
    re.I,
)

_NOISE_PATTERNS = re.compile(
    r"(login|logout|privacy|cookie|terms|contact|about|blog|press|investor)",
    re.I,
)


class FallbackScraper:
    """Best-effort HTML scraper; returns whatever job-like links it can find."""

    def __init__(self, http_client: ResilientHttpClient | None = None) -> None:
        self.http_client = http_client or ResilientHttpClient()

    def scrape(self, company_name: str, career_url: str) -> List[UnifiedJob]:
        """Fetch the page and extract jobs. Returns an empty list on failure."""
        try:
            response = self.http_client.request("GET", career_url)
            html = response.text
        except Exception:
            return []

        # Prefer structured data (schema.org JobPosting) when present.
        ld_jobs = extract_jobpostings_from_ld_json(html)
        if ld_jobs:
            return self._ld_to_unified(ld_jobs, company_name, career_url)

        # Fall back to link heuristics.
        return self._links_to_unified(html, company_name, career_url)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _ld_to_unified(
        self,
        records: list[dict],
        company_name: str,
        career_url: str,
    ) -> List[UnifiedJob]:
        jobs: List[UnifiedJob] = []
        for r in records:
            location = r.get("location") or ""
            jobs.append(
                UnifiedJob(
                    job_id=r.get("job_id") or "",
                    title=r.get("title") or "",
                    company=r.get("company") or company_name,
                    location=location,
                    remote=normalize_bool_remote(location),
                    description=r.get("description") or "",
                    posted_date=r.get("posted_date") or "",
                    apply_url=r.get("apply_url") or career_url,
                    source_system="html_ld_json",
                    employment_type=r.get("employment_type") or "",
                    experience_level="",
                )
            )
        return jobs

    def _links_to_unified(
        self,
        html: str,
        company_name: str,
        career_url: str,
    ) -> List[UnifiedJob]:
        soup = BeautifulSoup(html, "html.parser")
        base = f"{urlparse(career_url).scheme}://{urlparse(career_url).netloc}"
        seen_hrefs: set[str] = set()
        jobs: List[UnifiedJob] = []

        for anchor in soup.select("a[href]"):
            href = str(anchor.get("href") or "").strip()
            text = anchor.get_text(" ", strip=True)

            if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                continue
            if _NOISE_PATTERNS.search(href) or _NOISE_PATTERNS.search(text):
                continue
            if not _JOB_LINK_HINTS.search(href) and not _JOB_LINK_HINTS.search(text):
                continue

            full_url = href if href.startswith("http") else urljoin(base + "/", href.lstrip("/"))
            if full_url in seen_hrefs:
                continue
            seen_hrefs.add(full_url)

            jobs.append(
                UnifiedJob(
                    job_id="",
                    title=text or "(untitled)",
                    company=company_name,
                    location="",
                    remote=False,
                    description="",
                    posted_date="",
                    apply_url=full_url,
                    source_system="html_scrape",
                    employment_type="",
                    experience_level="",
                )
            )

        return jobs
