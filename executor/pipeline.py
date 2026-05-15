from __future__ import annotations

import asyncio
from typing import List

from core.config import AppConfig
from core.models import Job, ScoredJob
from db.database import JobDatabase
from engine.decision import decide
from engine.prioritizer import prioritize
from engine.relevance import filter_relevant_jobs
from engine.scorer import JobScorer
from executor.safe_apply import SafeApplyExecutor
from sources.runner import fetch_all_sources
from utils.logging import get_logger
from utils.notifier import notify_all
from utils.pipeline_writer import append_jobs_to_pipeline
from utils.resume_manager import ResumeManager

logger = get_logger("pipeline")


class JobAutomationPipeline:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.db = JobDatabase()
        self.resume_manager = ResumeManager()
        self.scorer = JobScorer(config, self.resume_manager)
        self.apply_executor = SafeApplyExecutor(
            dry_run=config.runtime.dry_run_apply,
            safe_submit=config.runtime.safe_submit,
        )

    async def run_once(self) -> dict:
        logger.info("Starting pipeline iteration")

        # 1) Fetch
        jobs = await fetch_all_sources(
            source_config=self.config.sources,
            max_parallel=self.config.runtime.max_parallel_sources,
            timeout_seconds=self.config.runtime.source_timeout_seconds,
        )

        # 2) Dedup (DB hash guard)
        unique_jobs: List[Job] = []
        for job in jobs:
            if self.db.exists_hash(job.dedup_hash()):
                continue
            unique_jobs.append(job)

        # 2.5) Keep only role-relevant jobs for the active profile.
        relevant_jobs = filter_relevant_jobs(unique_jobs, self.config.relevance_filters)
        logger.info(
            "Relevance filter kept %s/%s jobs",
            len(relevant_jobs),
            len(unique_jobs),
        )

        # 3) Score
        scored = self.scorer.score_jobs(relevant_jobs)

        # Persist fresh scan links to pipeline.md grouped under timestamp headers.
        appended_to_pipeline = append_jobs_to_pipeline(scored)
        logger.info("Appended %s jobs to data/pipeline.md", appended_to_pipeline)

        # 4) Prioritize
        prioritized = prioritize(scored)

        applied = 0
        saved = 0
        skipped = 0

        # 5) Decide + execute + 6) store
        for item in prioritized:
            action = decide(item.score, self.config.thresholds)
            if action == "APPLY":
                ok, message = await self.apply_executor.apply(item)
                status = "applied" if ok else "saved"
                if ok:
                    applied += 1
                    notify_all(
                        self.config.notifications,
                        f"Application submitted: {item.job.company} | {item.job.title} | score={item.score}",
                    )
                else:
                    saved += 1
                logger.info("APPLY candidate => %s (%s)", item.job.url, message)
                self.db.upsert_job(item, status=status)

            elif action == "SAVE":
                saved += 1
                self.db.upsert_job(item, status="saved")
                if item.score >= self.config.thresholds.apply - 5:
                    notify_all(
                        self.config.notifications,
                        f"High-score job found: {item.job.company} | {item.job.title} | score={item.score}",
                    )

            else:
                skipped += 1
                self.db.upsert_job(item, status="skipped")

        summary = {
            "fetched": len(jobs),
            "new": len(unique_jobs),
            "relevant": len(relevant_jobs),
            "pipeline_added": appended_to_pipeline,
            "applied": applied,
            "saved": saved,
            "skipped": skipped,
        }
        logger.info("Pipeline completed: %s", summary)
        return summary

    async def close(self) -> None:
        self.db.close()


def run_pipeline_sync(config: AppConfig) -> dict:
    pipeline = JobAutomationPipeline(config)

    async def _run() -> dict:
        try:
            return await pipeline.run_once()
        finally:
            await pipeline.close()

    return asyncio.run(_run())
