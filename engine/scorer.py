from __future__ import annotations

import re
from typing import List, Tuple

import requests

from core.config import AppConfig
from core.models import Job, ScoredJob
from utils.resume_manager import ResumeManager


class JobScorer:
    def __init__(self, config: AppConfig, resume_manager: ResumeManager) -> None:
        self.config = config
        self.resume_manager = resume_manager

    def score_jobs(self, jobs: List[Job]) -> List[ScoredJob]:
        scored: List[ScoredJob] = []
        for job in jobs:
            resume_type = self.resume_manager.choose_resume(job.title, job.description)
            resume_text = self.resume_manager.load_resume_text(resume_type)
            score, explanation = self.score_single(job, resume_text)
            scored.append(
                ScoredJob(job=job, score=score, explanation=explanation, resume_type=resume_type)
            )
        return scored

    def score_single(self, job: Job, resume_text: str) -> Tuple[int, str]:
        keyword_score = self._keyword_match(job)
        skills_score = self._skills_match(job, resume_text)
        exp_score = self._experience_match(job)
        llm_score = self._llm_score(job)

        w = self.config.weights
        weighted = (
            keyword_score * w.keyword
            + skills_score * w.skills
            + exp_score * w.experience
            + llm_score * w.llm
        ) / max((w.keyword + w.skills + w.experience + w.llm), 1)

        final = max(0, min(100, int(round(weighted))))
        explanation = (
            f"keyword={keyword_score}, skills={skills_score}, "
            f"experience={exp_score}, llm={llm_score}"
        )
        return final, explanation

    def _keyword_match(self, job: Job) -> int:
        text = f"{job.title} {job.description}".lower()
        if not self.config.keywords:
            return 50
        hits = sum(1 for kw in self.config.keywords if kw.lower() in text)
        return int((hits / len(self.config.keywords)) * 100)

    def _skills_match(self, job: Job, resume_text: str) -> int:
        text = f"{job.title} {job.description}".lower()
        skills = [s.lower() for s in self.config.skills]
        if not skills:
            return 50

        jd_hits = sum(1 for s in skills if s in text)
        resume_hits = sum(1 for s in skills if s in resume_text.lower())
        raw = (jd_hits * 0.6 + resume_hits * 0.4) / len(skills)
        return int(min(100, raw * 100))

    def _experience_match(self, job: Job) -> int:
        text = f"{job.title} {job.description}".lower()
        requested_years = self._extract_years(text)
        if requested_years <= 0:
            return 85
        if self.config.years_experience >= requested_years:
            return 100
        ratio = self.config.years_experience / requested_years
        return int(max(0, min(100, ratio * 100)))

    def _llm_score(self, job: Job) -> int:
        llm_cfg = self.config.sources.get("llm", {})
        if not llm_cfg.get("enabled", False):
            return 50

        provider = llm_cfg.get("provider", "ollama")
        try:
            if provider == "ollama":
                return self._ollama_score(job, llm_cfg)
            return 50
        except Exception:
            return 50

    def _ollama_score(self, job: Job, llm_cfg: dict) -> int:
        model = llm_cfg.get("model", "llama3")
        url = llm_cfg.get("url", "http://localhost:11434/api/generate")
        prompt = (
            "Rate this job from 0-100 for a strong candidate profile. "
            "Return only a number.\n"
            f"Title: {job.title}\nCompany: {job.company}\nDescription: {job.description[:1500]}"
        )
        resp = requests.post(
            url,
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=20,
        )
        resp.raise_for_status()
        text = (resp.json().get("response") or "50").strip()
        found = re.findall(r"\d+", text)
        if not found:
            return 50
        return max(0, min(100, int(found[0])))

    def _extract_years(self, text: str) -> int:
        matches = re.findall(r"(\d+)\+?\s*(?:years|yrs)", text)
        if not matches:
            return 0
        return max(int(m) for m in matches)
