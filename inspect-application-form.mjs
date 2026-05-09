#!/usr/bin/env node

import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node inspect-application-form.mjs <job-url>');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const applyButtons = [
    page.getByRole('button', { name: /apply/i }).last(),
    page.getByText(/apply for this job/i).last(),
    page.locator('a,button').filter({ hasText: /apply/i }).last(),
  ];
  for (const apply of applyButtons) {
    if (await apply.count().catch(() => 0)) {
      await apply.scrollIntoViewIfNeeded().catch(() => {});
      await apply.click().catch(() => {});
      await page.waitForTimeout(5000);
      break;
    }
  }

  const data = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const fields = [...document.querySelectorAll('input, textarea, select, button')]
      .map((el) => {
        const label =
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          document.querySelector(`label[for="${el.id}"]`)?.innerText ||
          el.closest('label')?.innerText ||
          el.name ||
          el.id ||
          el.type ||
          el.tagName;
        return {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          name: el.getAttribute('name') || '',
          label: label?.trim().replace(/\s+/g, ' ').slice(0, 200) || '',
          required: el.required || el.getAttribute('aria-required') === 'true',
          text: el.innerText?.trim().replace(/\s+/g, ' ').slice(0, 200) || '',
        };
      });
    return { url: location.href, title: document.title, text, fields };
  });

  console.log(JSON.stringify(data, null, 2));
} finally {
  await browser.close();
}
