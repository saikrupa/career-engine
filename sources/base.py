from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List

from core.models import Job


class JobSource(ABC):
    name: str = "base"

    def __init__(self, config: dict) -> None:
        self.config = config

    @abstractmethod
    async def fetch(self) -> List[Job]:
        raise NotImplementedError
