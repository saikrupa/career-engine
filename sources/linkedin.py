from __future__ import annotations

import asyncio
import random
from datetime import datetime, timezone
from typing import List
from urllib.parse import quote_plus

from playwright.async_api import async_playwright

from core.models import Job
from sources.base import JobSource


class LinkedInSource(JobSource):
    name = "linkedin"

    async def fetch(self) -> List[Job]:
        query = self.config.get("query", "software engineer")
        location = self.config.get("location", "United States")
        max_items = int(self.config.get("max_items", 25))
        search_url = (
            "https://www.linkedin.com/jobs/search/?keywords="
            f"{quote_plus(query)}&location={quote_plus(location)}"
        )

        jobs: List[Job] = []
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(search_url, wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(random.uniform(1.2, 2.5))

            cards = await page.query_selector_all("ul.jobs-search__results-list li")
            for card in cards[:max_items]:
                title_el = await card.query_selector("h3")
                company_el = await card.query_selector("h4")
                location_el = await card.query_selector(".job-search-card__location")
                link_el = await card.query_selector("a.base-card__full-link")
                date_el = await card.query_selector("time")

                title = (await title_el.inner_text()) if title_el else ""
                company = (await company_el.inner_text()) if company_el else ""
                loc = (await location_el.inner_text()) if location_el else ""
                link = (await link_el.get_attribute("href")) if link_el else ""
                posted = (
                    (await date_el.get_attribute("datetime"))
                    if date_el
                    else datetime.now(timezone.utc).isoformat()
                )

                if not link:
                    continue

                jobs.append(
                    Job(
                        id=link,
                        title=title.strip(),
                        company=company.strip(),
                        location=loc.strip(),
                        description="LinkedIn listing - open URL for details",
                        url=link,
                        source=self.name,
                        posted_time=posted,
                        easy_apply="easy apply" in title.lower(),
                    )
                )

            await browser.close()

        return jobs
