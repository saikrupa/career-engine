from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from core.models import Job


REQUIRED_FIELDS = [
    "id",
    "title",
    "company",
    "location",
    "description",
    "url",
    "source",
    "posted_time",
]


def normalize_job(raw: Dict[str, Any], source: str) -> Job:
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = {
        "id": str(raw.get("id") or raw.get("job_id") or raw.get("url") or ""),
        "title": str(raw.get("title") or "").strip(),
        "company": str(raw.get("company") or "").strip(),
        "location": str(raw.get("location") or "").strip(),
        "description": str(raw.get("description") or "").strip(),
        "url": str(raw.get("url") or raw.get("apply_url") or "").strip(),
        "source": source,
        "posted_time": str(raw.get("posted_time") or raw.get("posted_date") or now_iso),
        "easy_apply": bool(raw.get("easy_apply", False)),
        "metadata": dict(raw.get("metadata") or {}),
    }

    for field in REQUIRED_FIELDS:
        if not payload[field]:
            if field == "posted_time":
                payload[field] = now_iso
            else:
                payload[field] = "unknown"

    return Job(**payload)
