"""Abstract connector contract for ATS integrations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Iterable, List, Optional

from ..http_client import ResilientHttpClient
from ..schema import UnifiedJob


class BaseConnector(ABC):
    """All ATS connectors must implement this contract."""

    source_system: str = "unknown"

    def __init__(
        self,
        career_url: str,
        company_name: Optional[str] = None,
        http_client: Optional[ResilientHttpClient] = None,
    ) -> None:
        self.career_url = career_url.rstrip("/")
        self.company_name = company_name or ""
        self.http_client = http_client or ResilientHttpClient()

    @abstractmethod
    def fetch_jobs(self, *, keyword: str = "", location: str = "") -> List[Dict[str, Any]]:
        """Fetch source-native records."""

    @abstractmethod
    def parse_response(self, payload: Any) -> List[Dict[str, Any]]:
        """Convert raw response payload into source-native records."""

    @abstractmethod
    def normalize(self, records: Iterable[Dict[str, Any]]) -> List[UnifiedJob]:
        """Normalize source-native records to UnifiedJob entries."""

    def run(self, *, keyword: str = "", location: str = "") -> List[UnifiedJob]:
        records = self.fetch_jobs(keyword=keyword, location=location)
        return self.normalize(records)
