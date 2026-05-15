"""End-to-end flow: detect -> route -> fetch -> normalize -> dedup."""

from __future__ import annotations

from typing import Dict, List

from .detection import detect_ats
from .exceptions import ConnectorError
from .normalize import deduplicate_jobs
from .registry import build_connector
from .schema import UnifiedJob


def ingest_company_jobs(
    *,
    company_name: str,
    career_url: str,
    keyword: str = "",
    location: str = "",
) -> Dict[str, object]:
    detection = detect_ats(career_url)
    connector = build_connector(
        ats_type=str(detection["ats_type"]),
        career_url=career_url,
        company_name=company_name,
    )

    try:
        jobs: List[UnifiedJob] = connector.run(keyword=keyword, location=location)
    except Exception as exc:
        raise ConnectorError(
            f"Connector failed for company={company_name}, url={career_url}: {exc}"
        ) from exc

    unique_jobs = deduplicate_jobs(jobs)

    return {
        "company": company_name,
        "career_url": career_url,
        "ats_detection": detection,
        "jobs": [job.to_dict() for job in unique_jobs],
        "count": len(unique_jobs),
    }


def ingest_company_batch(
    companies: List[Dict[str, str]], keyword: str = "", location: str = ""
) -> List[Dict[str, object]]:
    """Run ingestion across many companies while isolating connector failures."""
    results: List[Dict[str, object]] = []
    for company in companies:
        company_name = company.get("company", "")
        career_url = company.get("career_url", "")
        if not company_name or not career_url:
            results.append(
                {
                    "company": company_name,
                    "career_url": career_url,
                    "status": "error",
                    "error": "Missing company or career_url",
                }
            )
            continue

        try:
            payload = ingest_company_jobs(
                company_name=company_name,
                career_url=career_url,
                keyword=keyword,
                location=location,
            )
            payload["status"] = "ok"
            results.append(payload)
        except Exception as exc:
            results.append(
                {
                    "company": company_name,
                    "career_url": career_url,
                    "status": "error",
                    "error": str(exc),
                }
            )
    return results
