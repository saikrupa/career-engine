"""Connector registry and factory helpers."""

from __future__ import annotations

from typing import Optional

from .connectors import CONNECTOR_MAP
from .connectors.base import BaseConnector
from .exceptions import ConnectorError


def build_connector(ats_type: str, career_url: str, company_name: Optional[str] = None) -> BaseConnector:
    connector_cls = CONNECTOR_MAP.get(ats_type)
    if not connector_cls:
        raise ConnectorError(f"No connector registered for ats_type={ats_type}")
    return connector_cls(career_url=career_url, company_name=company_name)
