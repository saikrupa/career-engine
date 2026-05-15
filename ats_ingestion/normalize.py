"""Normalization helpers that map source-specific payloads to UnifiedJob."""

from __future__ import annotations

from typing import Iterable, List, Set

from .schema import UnifiedJob


def normalize_bool_remote(location: str) -> bool:
    low = (location or "").lower()
    return any(token in low for token in ("remote", "work from home", "virtual"))


def deduplicate_jobs(jobs: Iterable[UnifiedJob]) -> List[UnifiedJob]:
    seen: Set[str] = set()
    output: List[UnifiedJob] = []
    for job in jobs:
        key = job.dedup_key()
        if key in seen:
            continue
        seen.add(key)
        output.append(job)
    return output
