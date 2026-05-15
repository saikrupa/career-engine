from __future__ import annotations

from pathlib import Path


class ResumeManager:
    def __init__(self, resume_dir: str = "resumes") -> None:
        self.resume_dir = Path(resume_dir)

    def load_resume_text(self, resume_type: str) -> str:
        path = self.resume_dir / f"{resume_type}.txt"
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")

    def choose_resume(self, title: str, description: str) -> str:
        text = f"{title} {description}".lower()
        if any(
            k in text
            for k in (
                "android",
                "kotlin",
                "jetpack",
                "compose",
                "kmp",
                "mobile app",
            )
        ):
            return "android"
        if any(k in text for k in ("data", "ml", "analytics", "ai", "scientist")):
            return "data"
        if any(k in text for k in ("frontend", "react", "ui", "javascript", "web")):
            return "frontend"
        return "backend"
