from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from core.models import ScoredJob


class JobDatabase:
    def __init__(self, db_path: str = "db/jobs.db") -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                dedup_hash TEXT UNIQUE,
                title TEXT NOT NULL,
                company TEXT NOT NULL,
                status TEXT NOT NULL,
                score INTEGER NOT NULL,
                explanation TEXT,
                resume_type TEXT,
                source TEXT,
                url TEXT,
                timestamp TEXT NOT NULL
            )
            """
        )
        self.conn.commit()

    def upsert_job(self, item: ScoredJob, status: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        row_id = f"{item.job.source}:{item.job.id}"
        self.conn.execute(
            """
            INSERT INTO jobs (id, dedup_hash, title, company, status, score, explanation, resume_type, source, url, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status=excluded.status,
                score=excluded.score,
                explanation=excluded.explanation,
                resume_type=excluded.resume_type,
                source=excluded.source,
                url=excluded.url,
                timestamp=excluded.timestamp
            """,
            (
                row_id,
                item.job.dedup_hash(),
                item.job.title,
                item.job.company,
                status.lower(),
                int(item.score),
                item.explanation,
                item.resume_type,
                item.job.source,
                item.job.url,
                now,
            ),
        )
        self.conn.commit()

    def exists_hash(self, dedup_hash: str) -> bool:
        row = self.conn.execute("SELECT 1 FROM jobs WHERE dedup_hash = ?", (dedup_hash,)).fetchone()
        return row is not None

    def close(self) -> None:
        self.conn.close()
