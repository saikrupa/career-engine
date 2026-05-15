"""High-level orchestrator: detect → connector → scrape → interactive.

This is the layer that run_pipeline.py calls. It handles the full decision
tree so the entry-point script stays thin.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .detection import detect_ats
from .exceptions import ConnectorError, DetectionError
from .fallback_scraper import FallbackScraper
from .interactive import prompt_manual_jobs, prompt_manual_url
from .normalize import deduplicate_jobs
from .registry import build_connector
from .schema import UnifiedJob


# ---------------------------------------------------------------------------
# Result type helpers
# ---------------------------------------------------------------------------

def _ok(company: str, url: str, ats: str, confidence: float, jobs: List[UnifiedJob]) -> Dict[str, Any]:
    return {
        "company": company,
        "career_url": url,
        "ats_type": ats,
        "confidence": confidence,
        "strategy": "connector" if ats not in ("html_ld_json", "html_scrape", "manual") else ats,
        "jobs": [j.to_dict() for j in deduplicate_jobs(jobs)],
        "count": len(deduplicate_jobs(jobs)),
        "status": "ok",
    }


def _fallback(company: str, url: str, strategy: str, jobs: List[UnifiedJob]) -> Dict[str, Any]:
    unique = deduplicate_jobs(jobs)
    return {
        "company": company,
        "career_url": url,
        "ats_type": "unknown",
        "confidence": 0.0,
        "strategy": strategy,
        "jobs": [j.to_dict() for j in unique],
        "count": len(unique),
        "status": "ok" if unique else "empty",
    }


def _skipped(company: str, url: str, reason: str) -> Dict[str, Any]:
    return {
        "company": company,
        "career_url": url,
        "ats_type": "unknown",
        "confidence": 0.0,
        "strategy": "skipped",
        "jobs": [],
        "count": 0,
        "status": "skipped",
        "reason": reason,
    }


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def process_company(
    company_name: str,
    career_url: str,
    *,
    keyword: str = "",
    location: str = "",
    interactive: bool = True,
    scraper: FallbackScraper | None = None,
) -> Dict[str, Any]:
    """
    Full decision tree for a single company:

      1. Try ATS detection + connector
      2. If detection fails → HTML scrape (ld+json first, link heuristics second)
      3. If scrape is empty + interactive mode → ask user for a new URL / manual entry
      4. If non-interactive → return skipped result
    """
    scraper = scraper or FallbackScraper()

    # ------------------------------------------------------------------ step 1
    try:
        detection = detect_ats(career_url)
        ats_type = str(detection["ats_type"])
        confidence = float(str(detection["confidence"]))
        connector = build_connector(
            ats_type=ats_type,
            career_url=career_url,
            company_name=company_name,
        )
        jobs = connector.run(keyword=keyword, location=location)
        return _ok(company_name, career_url, ats_type, confidence, jobs)
    except DetectionError:
        pass  # No ATS recognised → try scraping
    except ConnectorError:
        pass  # ATS recognised but connector failed → still try scraping

    # ------------------------------------------------------------------ step 2
    html_jobs = scraper.scrape(company_name, career_url)
    if html_jobs:
        source = html_jobs[0].source_system  # "html_ld_json" or "html_scrape"
        return _fallback(company_name, career_url, source, html_jobs)

    # ------------------------------------------------------------------ step 3
    if not interactive:
        return _skipped(company_name, career_url, "ATS unknown and scrape returned nothing")

    # Ask user if they have a better URL
    alt_url = prompt_manual_url(company_name, career_url)
    if alt_url and alt_url != career_url:
        # Retry the full pipeline once with the new URL
        return process_company(
            company_name,
            alt_url,
            keyword=keyword,
            location=location,
            interactive=False,  # only one interactive retry
            scraper=scraper,
        )

    # Last resort: let user paste jobs by hand
    manual_records = prompt_manual_jobs(company_name)
    if not manual_records:
        return _skipped(company_name, career_url, "User skipped")

    manual_jobs = [
        UnifiedJob(
            job_id="",
            title=r.get("title") or "(untitled)",
            company=company_name,
            location="",
            remote=False,
            description="",
            posted_date="",
            apply_url=r.get("apply_url") or career_url,
            source_system="manual",
            employment_type="",
            experience_level="",
        )
        for r in manual_records
    ]
    return _fallback(company_name, career_url, "manual", manual_jobs)


def run_pipeline(
    companies: List[Dict[str, str]],
    *,
    keyword: str = "",
    location: str = "",
    interactive: bool = True,
) -> List[Dict[str, Any]]:
    """Process every company in the list and return all results."""
    results: List[Dict[str, Any]] = []
    for entry in companies:
        name = (entry.get("company") or "").strip()
        url = (entry.get("careers_url") or entry.get("career_url") or "").strip()
        if not name or not url:
            results.append(_skipped(name, url, "Missing company name or URL in config"))
            continue
        result = process_company(
            name, url, keyword=keyword, location=location, interactive=interactive
        )
        results.append(result)
    return results
