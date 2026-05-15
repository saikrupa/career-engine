from __future__ import annotations

from typing import List

from core.config import RelevanceFilters
from core.models import Job


def filter_relevant_jobs(jobs: List[Job], filters: RelevanceFilters) -> List[Job]:
    if not jobs:
        return []

    include = [x.lower() for x in (filters.include_any or [])]
    exclude = [x.lower() for x in (filters.exclude_any or [])]
    loc_inc = [x.lower() for x in (filters.location_include_any or [])]

    kept: List[Job] = []
    for job in jobs:
        text = f"{job.title} {job.description}".lower()
        location = (job.location or "").lower()

        if include and not any(token in text for token in include):
            continue

        if exclude and any(token in text for token in exclude):
            continue

        if loc_inc and location and not any(token in location for token in loc_inc):
            # Keep fully remote jobs regardless of explicit location tokens.
            if "remote" not in location:
                continue

        kept.append(job)

    return kept
