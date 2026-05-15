"""Unified schema for normalized jobs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from hashlib import sha256
from typing import Any, Dict


@dataclass
class UnifiedJob:
    job_id: str
    title: str
    company: str
    location: str
    remote: bool
    description: str
    posted_date: str
    apply_url: str
    source_system: str
    employment_type: str
    experience_level: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def dedup_key(self) -> str:
        raw_key = "|".join(
            [
                self.source_system.lower().strip(),
                self.company.lower().strip(),
                self.title.lower().strip(),
                self.location.lower().strip(),
                self.apply_url.lower().strip(),
            ]
        )
        return sha256(raw_key.encode("utf-8")).hexdigest()
