from __future__ import annotations

import asyncio
import random
from typing import Tuple

from playwright.async_api import async_playwright

from core.models import ScoredJob
from utils.logging import get_logger

logger = get_logger("safe-apply")


class SafeApplyExecutor:
    def __init__(self, dry_run: bool = True, safe_submit: bool = False) -> None:
        self.dry_run = dry_run
        self.safe_submit = safe_submit

    async def apply(self, item: ScoredJob) -> Tuple[bool, str]:
        """
        Returns (success, message).

        Safety constraints:
        - Only attempts simple one-step forms.
        - Adds randomized delays.
        - Skips multi-step or unknown workflows.
        - By default, does not click final submit (dry_run or safe_submit=False).
        """
        if not item.job.easy_apply:
            return False, "No easy-apply signal"

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            try:
                await page.goto(item.job.url, wait_until="domcontentloaded", timeout=45000)
                await asyncio.sleep(random.uniform(1.5, 3.2))

                easy_button = await page.query_selector(
                    "button:has-text('Easy Apply'), button:has-text('Apply Now'), a:has-text('Easy Apply')"
                )
                if not easy_button:
                    return False, "Easy apply button not found"

                await easy_button.click()
                await asyncio.sleep(random.uniform(1.0, 2.5))

                steps = await page.query_selector_all("button:has-text('Next'), button:has-text('Continue')")
                if len(steps) > 1:
                    return False, "Complex multi-step flow skipped"

                if self.dry_run or not self.safe_submit:
                    return True, "Dry-run complete: form detected, submit blocked for safety"

                submit_btn = await page.query_selector(
                    "button:has-text('Submit application'), button:has-text('Submit')"
                )
                if not submit_btn:
                    return False, "Submit button not found"

                await asyncio.sleep(random.uniform(1.2, 3.0))
                await submit_btn.click()
                await asyncio.sleep(random.uniform(1.0, 1.8))
                return True, "Application submitted"
            except Exception as exc:
                logger.warning("Apply failed for %s: %s", item.job.url, exc)
                return False, str(exc)
            finally:
                await browser.close()
