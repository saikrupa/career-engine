from __future__ import annotations

from core.config import Thresholds


def decide(score: int, thresholds: Thresholds) -> str:
    if score > thresholds.apply:
        return "APPLY"
    if thresholds.save <= score <= thresholds.apply:
        return "SAVE"
    return "SKIP"
