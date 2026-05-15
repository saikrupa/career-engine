from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Dict


@dataclass
class Job:
    id: str
    title: str
    company: str
    location: str
    description: str
    url: str
    source: str
    posted_time: str
    easy_apply: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def dedup_hash(self) -> str:
        key = "|".join(
            [
                self.source.lower().strip(),
                self.company.lower().strip(),
                self.title.lower().strip(),
                self.location.lower().strip(),
                self.url.lower().strip(),
            ]
        )
        return sha256(key.encode("utf-8")).hexdigest()

    def posted_datetime(self) -> datetime:
        try:
            dt = datetime.fromisoformat(self.posted_time.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return datetime.now(timezone.utc)


@dataclass
class ScoredJob:
    job: Job
    score: int
    explanation: str
    resume_type: str
