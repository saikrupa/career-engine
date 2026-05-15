from __future__ import annotations

from typing import Dict, List

from sources.base import JobSource
from sources.greenhouse import GreenhouseSource
from sources.indeed import IndeedSource
from sources.lever import LeverSource
from sources.linkedin import LinkedInSource
from sources.workday import WorkdaySource

SOURCE_CLASSES = {
    "linkedin": LinkedInSource,
    "indeed": IndeedSource,
    "greenhouse": GreenhouseSource,
    "lever": LeverSource,
    "workday": WorkdaySource,
}


def build_sources(source_config: Dict[str, dict]) -> List[JobSource]:
    sources: List[JobSource] = []
    for name, cfg in source_config.items():
        if not cfg or not cfg.get("enabled", False):
            continue
        cls = SOURCE_CLASSES.get(name)
        if cls:
            sources.append(cls(cfg))
    return sources
