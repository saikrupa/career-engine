"""ATS detection from career URLs."""

from __future__ import annotations

import re
from typing import Dict, List, Tuple

from .exceptions import DetectionError


ATS_SIGNATURES: List[Tuple[str, str, float]] = [
    (r"myworkdayjobs\.com|wd\d+\.myworkdayjobs\.com|/wday/", "workday", 0.98),
    (r"taleo\.net|oraclecloud\.com|/careersection/|hcmUI/CandidateExperience", "taleo", 0.96),
    (r"successfactors\.com|jobs\.sap\.com|career\?company=", "successfactors", 0.95),
    (r"icims\.com|icims\.io", "icims", 0.95),
    (r"ultipro\.com|ukg\.com", "ukg", 0.9),
    (r"adp\.com|mykronos\.com", "adp", 0.86),
    (r"greenhouse\.io|job-boards\.greenhouse\.io", "greenhouse", 0.99),
    (r"lever\.co", "lever", 0.99),
    (r"ashbyhq\.com", "ashby", 0.99),
]


def detect_ats(career_url: str) -> Dict[str, float | str]:
    low = career_url.lower().strip()
    for pattern, ats_type, confidence in ATS_SIGNATURES:
        if re.search(pattern, low):
            return {"ats_type": ats_type, "confidence": confidence}
    raise DetectionError(f"Unable to detect ATS from URL: {career_url}")
