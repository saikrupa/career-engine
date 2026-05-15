from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Iterable

from core.models import Job
from core.models import ScoredJob


PIPELINE_PATH = Path("data/pipeline.md")


def _timestamp_header(now: datetime | None = None) -> str:
    dt = now or datetime.now()
    # Example: ## May-12-2026 6:20 AM
    month = dt.strftime("%b")
    day = dt.strftime("%d")
    year = dt.strftime("%Y")
    time_part = dt.strftime("%I:%M %p").lstrip("0")
    return f"## {month}-{day}-{year} {time_part}"


def _extract_existing_urls(text: str) -> set[str]:
    urls = set()
    for line in text.splitlines():
        m = re.match(r"\s*- \[ \] (\S+)\s+\|", line)
        if m:
            urls.add(m.group(1).strip())
    return urls


def append_jobs_to_pipeline(scored_jobs: Iterable[ScoredJob]) -> int:
    """Append new jobs to data/pipeline.md under a timestamp section.

    Returns number of rows appended.
    """
    PIPELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not PIPELINE_PATH.exists():
        PIPELINE_PATH.write_text("## Pendientes\n\n## Procesadas\n", encoding="utf-8")

    original = PIPELINE_PATH.read_text(encoding="utf-8")
    existing_urls = _extract_existing_urls(original)

    rows: list[str] = []
    for item in scored_jobs:
        job = item.job
        if not job.url or job.url in existing_urls:
            continue
        rows.append(
            f"- [ ] {job.url} | {job.company} | {job.title} | Score: {int(item.score)}%"
        )
        existing_urls.add(job.url)

    if not rows:
        return 0

    section = _timestamp_header() + "\n" + "\n".join(rows) + "\n"

    marker = "\n## Procesadas"
    if marker in original:
        updated = original.replace(marker, "\n\n" + section + marker, 1)
    else:
        updated = original.rstrip() + "\n\n" + section + "\n## Procesadas\n"

    PIPELINE_PATH.write_text(updated, encoding="utf-8")
    return len(rows)
