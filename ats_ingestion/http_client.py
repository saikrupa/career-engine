"""Resilient HTTP client with retries, backoff, and header rotation."""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Dict, Optional

import requests

from .exceptions import ConnectorError, RateLimitedError


DEFAULT_USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]


@dataclass
class RetryPolicy:
    max_attempts: int = 4
    base_backoff_seconds: float = 0.75
    max_backoff_seconds: float = 6.0


class ResilientHttpClient:
    def __init__(
        self,
        timeout_seconds: int = 20,
        retry_policy: Optional[RetryPolicy] = None,
        user_agents: Optional[list[str]] = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.retry_policy = retry_policy or RetryPolicy()
        self.user_agents = user_agents or DEFAULT_USER_AGENTS
        self.session = requests.Session()

    def _next_headers(self, custom_headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers = {
            "User-Agent": random.choice(self.user_agents),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
        }
        if custom_headers:
            headers.update(custom_headers)
        return headers

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Optional[Dict[str, str]] = None,
        json_payload: Optional[dict] = None,
        data: Optional[dict] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> requests.Response:
        last_exc: Optional[Exception] = None
        for attempt in range(1, self.retry_policy.max_attempts + 1):
            try:
                response = self.session.request(
                    method=method,
                    url=url,
                    params=params,
                    json=json_payload,
                    data=data,
                    headers=self._next_headers(headers),
                    timeout=self.timeout_seconds,
                )
                if response.status_code == 429:
                    raise RateLimitedError(f"Rate limited by {url}")
                if 500 <= response.status_code < 600:
                    raise ConnectorError(
                        f"Server error from {url}: HTTP {response.status_code}"
                    )
                response.raise_for_status()
                return response
            except RateLimitedError as exc:
                last_exc = exc
            except (requests.RequestException, ConnectorError) as exc:
                last_exc = exc

            if attempt < self.retry_policy.max_attempts:
                wait_seconds = min(
                    self.retry_policy.max_backoff_seconds,
                    self.retry_policy.base_backoff_seconds * (2 ** (attempt - 1))
                    + random.uniform(0, 0.35),
                )
                time.sleep(wait_seconds)

        if isinstance(last_exc, RateLimitedError):
            raise last_exc
        raise ConnectorError(f"HTTP request failed for {url}: {last_exc}")
