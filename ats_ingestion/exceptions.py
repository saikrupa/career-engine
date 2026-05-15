"""Custom exceptions for ingestion components."""


class IngestionError(Exception):
    """Base ingestion error."""


class DetectionError(IngestionError):
    """Raised when ATS detection fails."""


class ConnectorError(IngestionError):
    """Raised when a connector cannot fetch or parse jobs."""


class RateLimitedError(ConnectorError):
    """Raised when rate limits are exceeded and retries are exhausted."""
