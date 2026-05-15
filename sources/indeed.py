from __future__ import annotations

import asyncio
import random
from datetime import datetime, timezone
from typing import List
from urllib.parse import quote_plus

from playwright.async_api import async_playwright

from core.models import Job
from sources.base import JobSource


class IndeedSource(JobSource):
    name = "indeed"

    async def fetch(self) -> List[Job]:
        query = self.config.get("query", "software engineer")
        location = self.config.get("location", "United States")
        max_items = int(self.config.get("max_items", 25))

        search_url = (
            "https://www.indeed.com/jobs?q="
            f"{quote_plus(query)}&l={quote_plus(location)}"
        )

        jobs: List[Job] = []
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(search_url, wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(random.uniform(1.2, 2.5))

            cards = await page.query_selector_all("div.job_seen_beacon")
            for card in cards[:max_items]:
                title_el = await card.query_selector("h2 a")
                company_el = await card.query_selector("span.companyName")
                location_el = await card.query_selector("div.companyLocation")
                snippet_el = await card.query_selector("div.job-snippet")
                date_el = await card.query_selector("span.date")

                title = (await title_el.inner_text()) if title_el else ""
                href = (await title_el.get_attribute("href")) if title_el else ""
                company = (await company_el.inner_text()) if company_el else ""
                loc = (await location_el.inner_text()) if location_el else ""
                desc = (await snippet_el.inner_text()) if snippet_el else ""
                date_text = (await date_el.inner_text()) if date_el else ""

                if not href:
                    continue

                url = href if href.startswith("http") else f"https://www.indeed.com{href}"
                jobs.append(
                    Job(
                        id=url,
                        title=title.strip(),
                        company=company.strip(),
                        location=loc.strip(),
                        description=desc.strip(),
                        url=url,
                        source=self.name,
                        posted_time=self._relative_to_iso(date_text),
                        easy_apply=False,
                    )
                )

            await browser.close()

        return jobs

    def _relative_to_iso(self, text: str) -> str:
        now = datetime.now(timezone.utc)
        low = (text or "").lower()
        if "today" in low or "just" in low:
            return now.isoformat()
        if "1 day" in low or "yesterday" in low:
            return (now.replace(microsecond=0)).isoformat()
        return now.isoformat()
