"""Career-engine ATS ingestion package."""

from .detection import detect_ats
from .pipeline import ingest_company_batch, ingest_company_jobs
from .runner import process_company, run_pipeline
from .schema import UnifiedJob

__all__ = [
    "UnifiedJob",
    "detect_ats",
    "ingest_company_jobs",
    "ingest_company_batch",
    "process_company",
    "run_pipeline",
]
