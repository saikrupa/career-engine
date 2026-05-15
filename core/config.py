from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

import yaml


@dataclass
class Thresholds:
    apply: int = 75
    save: int = 60


@dataclass
class RuntimeConfig:
    interval_minutes: int
    max_parallel_sources: int
    source_timeout_seconds: int
    dry_run_apply: bool
    safe_submit: bool


@dataclass
class Weights:
    keyword: int
    skills: int
    experience: int
    llm: int


@dataclass
class RelevanceFilters:
    include_any: List[str]
    exclude_any: List[str]
    location_include_any: List[str]


@dataclass
class AppConfig:
    keywords: List[str]
    skills: List[str]
    years_experience: int
    target_roles: List[str]
    thresholds: Thresholds
    runtime: RuntimeConfig
    weights: Weights
    relevance_filters: RelevanceFilters
    sources: Dict[str, Dict[str, Any]]
    notifications: Dict[str, Any]


def load_config(path: str = "config.yaml") -> AppConfig:
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Missing config file: {path}")

    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}

    thresholds = Thresholds(**(raw.get("thresholds") or {}))
    runtime = RuntimeConfig(**(raw.get("runtime") or {}))
    weights = Weights(**(raw.get("weights") or {}))
    filter_raw = raw.get("relevance_filters") or {}
    relevance_filters = RelevanceFilters(
        include_any=filter_raw.get("include_any") or [],
        exclude_any=filter_raw.get("exclude_any") or [],
        location_include_any=filter_raw.get("location_include_any") or [],
    )

    return AppConfig(
        keywords=raw.get("keywords") or [],
        skills=raw.get("skills") or [],
        years_experience=int(raw.get("years_experience") or 0),
        target_roles=raw.get("target_roles") or [],
        thresholds=thresholds,
        runtime=runtime,
        weights=weights,
        relevance_filters=relevance_filters,
        sources=raw.get("sources") or {},
        notifications=raw.get("notifications") or {},
    )
