from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from core.models import ScoredJob


def prioritize(scored_jobs: List[ScoredJob]) -> List[ScoredJob]:
    now = datetime.now(timezone.utc)

    def _priority_key(item: ScoredJob) -> tuple:
        posted = item.job.posted_datetime()
        age_hours = (now - posted).total_seconds() / 3600.0
        recency = 2 if age_hours <= 2 else 1 if age_hours <= 24 else 0
        easy_apply = 1 if item.job.easy_apply else 0
        return (recency, easy_apply, item.score)

    return sorted(scored_jobs, key=_priority_key, reverse=True)
