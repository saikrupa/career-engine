#!/usr/bin/env node

import 'dotenv/config';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { notifyJobs } from './notify-alerts.mjs';

const PIPELINE_PATH = 'data/pipeline.md';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const APPLICATIONS_PATH = 'data/applications.md';
const PROFILE_ROOT = '.browser-profiles';
const MAX_PAGES = 3;
const DEFAULT_SCROLLS = 4;
const DEFAULT_DETAIL_LIMIT = 25;
const DEFAULT_ACTION_DELAY_MS = 1600;
const DEFAULT_SEARCH_DELAY_MS = 3000;

const US_SIGNALS = [
  'united states', 'usa', 'u.s.', ' us ', 'remote', 'texas', ' tx', 'dallas', 'plano',
  'austin', 'irving', 'frisco', 'fort worth', 'houston', 'san antonio', 'new york',
  'california', ' ca', 'washington', ' wa', 'illinois', ' il', 'georgia', ' ga',
  'north carolina', ' nc', 'florida', ' fl', 'colorado', ' co', 'arizona', ' az',
];

const NON_US_SIGNALS = [
  'canada', 'toronto', 'vancouver', 'montreal', 'india', 'bengaluru', 'bangalore',
  'hyderabad', 'pune', 'chennai', 'mumbai', 'united kingdom', 'uk', 'london',
  'germany', 'berlin', 'munich', 'france', 'paris', 'netherlands', 'amsterdam',
  'ireland', 'dublin', 'spain', 'madrid', 'portugal', 'lisbon', 'poland',
  'warsaw', 'brazil', 'argentina', 'mexico', 'australia', 'sydney', 'japan',
];

const STRONG_TERMS = [
  'android', 'kotlin', 'jetpack', 'compose', 'kmp', 'multiplatform', 'mobile platform',
  'mobile engineer', 'sdk', 'developer experience', 'devex', 'ai agents', 'agentic',
  'automation engineer', 'ai engineer',
];

const GOOD_TERMS = [
  'platform', 'foundation', 'architecture', 'developer tools', 'workflow', 'automation',
  'ai', 'llm', 'agents', 'cursor', 'copilot', 'claude', 'gemini', 'senior', 'lead',
  'staff', 'principal',
];

const NEGATIVE_TERMS = [
  'ios engineer', 'swift', 'objective-c', 'frontend only', 'sales', 'account executive',
  'product manager', 'designer', 'intern', 'new grad', 'qa manual', 'data entry',
];

const LOCATION_PRIORITIES = [
  {
    key: 'remote',
    label: 'REMOTE - jump on this',
    rank: 0,
    terms: ['remote', 'work from home', 'work anywhere', 'anywhere in the united states', 'anywhere in us', 'anywhere in the us'],
  },
  {
    key: 'dallas-dfw',
    label: 'A1 Dallas/DFW',
    rank: 1,
    terms: ['dallas', 'plano', 'irving', 'frisco', 'fort worth', 'arlington', 'richardson', 'addison', 'dfw'],
  },
  {
    key: 'texas',
    label: 'A2 Texas',
    rank: 2,
    terms: ['texas', ' tx', 'austin', 'houston', 'san antonio'],
  },
];

export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('linkedin.com')) {
      const jobId = parsed.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] || parsed.searchParams.get('currentJobId');
      if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}/`;
    }
    if (parsed.hostname.includes('indeed.com')) {
      const jk = parsed.searchParams.get('jk') || parsed.searchParams.get('vjk');
      if (jk) return `https://www.indeed.com/viewjob?jk=${jk}`;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(baseMs) {
  const base = Math.max(Number(baseMs || 0), 0);
  if (base === 0) return 0;
  return Math.round(base * (0.75 + Math.random() * 0.75));
}

export function isLikelyUsJob(job) {
  const location = ` ${cleanText(job.location).toLowerCase()} `;
  const haystack = ` ${cleanText(`${job.location} ${job.title} ${job.snippet}`).toLowerCase()} `;

  if (NON_US_SIGNALS.some((term) => haystack.includes(term))) return false;
  return US_SIGNALS.some((term) => location.includes(term) || haystack.includes(term));
}

export function classifyLocation(job) {
  const haystack = ` ${cleanText(`${job.location} ${job.detailLocation || ''} ${job.snippet}`).toLowerCase()} `;
  if (NON_US_SIGNALS.some((term) => haystack.includes(term))) {
    return { accepted: false, priority: 'OUT', rank: 99, reason: 'Non-US location signal' };
  }

  for (const bucket of LOCATION_PRIORITIES) {
    if (bucket.terms.some((term) => haystack.includes(term))) {
      return { accepted: true, priority: bucket.label, rank: bucket.rank, reason: bucket.key };
    }
  }

  return { accepted: false, priority: 'OUT', rank: 99, reason: 'Outside Remote/Dallas/Texas target' };
}

export function isRemoteJob(job) {
  return classifyLocation(job).reason === 'remote';
}

export function scoreJob(job) {
  const haystack = cleanText(`${job.title} ${job.company} ${job.location} ${job.snippet}`).toLowerCase();
  let score = 35;
  for (const term of STRONG_TERMS) {
    if (haystack.includes(term)) score += 9;
  }
  for (const term of GOOD_TERMS) {
    if (haystack.includes(term)) score += 4;
  }
  for (const term of NEGATIVE_TERMS) {
    if (haystack.includes(term)) score -= 15;
  }
  const location = classifyLocation(job);
  if (location.reason === 'remote') score += 20;
  if (location.reason === 'dallas-dfw') score += 16;
  if (location.reason === 'texas') score += 8;
  if (/h1b|visa sponsorship|sponsor/.test(haystack)) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function fitLabel(score) {
  if (score >= 85) return 'Strong match';
  if (score >= 65) return 'Good match';
  if (score >= 45) return 'Possible match';
  return 'Weak match';
}

export function postedTextFromSnippet(text) {
  const match = cleanText(text).match(/(\d+\s*(?:minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\s*ago|just now|moments ago)/i);
  return match?.[1] || '';
}

function jobKey(job) {
  return `${cleanText(job.company).toLowerCase()}::${cleanText(job.title).toLowerCase()}`;
}

export function extractionScript(portal) {
  return (portalName) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const absolute = (href) => {
      try {
        return new URL(href, location.href).toString();
      } catch {
        return href || '';
      }
    };
    const pickText = (root, selectors) => {
      for (const selector of selectors) {
        const el = root.querySelector(selector);
        const text = clean(el?.innerText || el?.getAttribute('aria-label') || el?.textContent);
        if (text) return text;
      }
      return '';
    };
    const pickHref = (root, selectors) => {
      for (const selector of selectors) {
        const el = root.querySelector(selector);
        const href = el?.href || el?.getAttribute('href');
        if (href) return absolute(href);
      }
      return '';
    };

    const configs = {
      linkedin: {
        card: [
          '[data-job-id]', '.jobs-search-results__list-item', '.job-card-container',
          '.base-card', 'li',
        ],
        title: [
          'a[href*="/jobs/view/"]', '.job-card-list__title', '.job-card-container__link',
          '.base-search-card__title', '[aria-label*="job"]',
        ],
        url: ['a[href*="/jobs/view/"]'],
        company: [
          '.job-card-container__primary-description', '.artdeco-entity-lockup__subtitle',
          '.base-search-card__subtitle', '[class*="company"]',
        ],
        location: [
          '.job-card-container__metadata-item', '.job-search-card__location',
          '.artdeco-entity-lockup__caption', '[class*="location"]',
        ],
        posted: ['time', '.job-card-container__listed-time', '[class*="listed-time"]'],
      },
      indeed: {
        card: [
          '[data-jk]', '.job_seen_beacon', '.jobsearch-ResultsList li', '.cardOutline',
          'div[class*="job"]',
        ],
        title: [
          '[data-testid="jobTitle"]', '.jobTitle', 'a[href*="/viewjob"]',
          'a[data-jk]', 'h2',
        ],
        url: ['a[href*="/viewjob"]', 'a[data-jk]', 'h2 a'],
        company: [
          '[data-testid="company-name"]', '[data-testid="companyName"]', '.companyName',
          '[data-company-name="true"]',
        ],
        location: [
          '[data-testid="text-location"]', '.companyLocation', '[data-testid="job-location"]',
          '[class*="location"]',
        ],
        posted: ['[data-testid="myJobsStateDate"]', '.date', '[class*="date"]'],
      },
    };

    const cfg = configs[portalName];
    const cards = [...document.querySelectorAll(cfg.card.join(','))];
    const jobs = [];
    const seen = new Set();

    for (const card of cards) {
      const url = pickHref(card, cfg.url);
      const title = pickText(card, cfg.title);
      if (!url || !title) continue;

      const key = `${url}|${title}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const company = pickText(card, cfg.company) || 'Unknown company';
      const locationText = pickText(card, cfg.location);
      const postedText = pickText(card, cfg.posted);
      const snippet = clean(card.innerText).slice(0, 700);
      jobs.push({
        title,
        company,
        location: locationText,
        url,
        snippet,
        postedText,
        easyApply: /easy apply/i.test(snippet),
      });
    }

    return {
      pageUrl: location.href,
      pageTitle: document.title,
      jobs,
    };
  };
}

function stripTags(value) {
  return cleanText(String(value || '').replace(/<[^>]+>/g, ' '));
}

function attrValue(markup, attr) {
  const match = markup.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
  return match?.[1] || '';
}

export function parseJobsFromFixtureHtml(portal, html, baseUrl = 'https://example.com') {
  const jobs = [];
  const seen = new Set();
  const linkPattern = portal === 'linkedin'
    ? /<a[^>]+href=["']([^"']*\/jobs\/view\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    : /<a[^>]+href=["']([^"']*(?:\/viewjob|\?jk=)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const linkMatch of html.matchAll(linkPattern)) {
    const start = Math.max(0, linkMatch.index - 900);
    const end = Math.min(html.length, linkMatch.index + linkMatch[0].length + 1200);
    const block = html.slice(start, end);

    const url = normalizeUrl(new URL(linkMatch[1], baseUrl).toString());
    const title = stripTags(linkMatch[2]);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);

    const company =
      stripTags(block.match(/<(?:div|span)[^>]*(?:company|primary-description)[^>]*>([\s\S]*?)<\/(?:div|span)>/i)?.[1]) ||
      attrValue(block, 'data-company-name') ||
      'Unknown company';
    const location =
      stripTags(block.match(/<(?:div|span)[^>]*(?:location|metadata-item)[^>]*>([\s\S]*?)<\/(?:div|span)>/i)?.[1]) ||
      '';

    const snippet = stripTags(block).slice(0, 700);
    jobs.push({
      title,
      company,
      location,
      url,
      snippet,
      postedText: postedTextFromSnippet(snippet),
      easyApply: /easy apply/i.test(snippet),
    });
  }

  return jobs;
}

export function loadSeen() {
  const urls = new Set();
  const companyRoles = new Set();

  for (const file of [SCAN_HISTORY_PATH, PIPELINE_PATH, APPLICATIONS_PATH]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      urls.add(normalizeUrl(match[0]));
    }
  }

  for (const file of [PIPELINE_PATH, APPLICATIONS_PATH]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const pending = line.match(/^- \[[ x!]\]\s+(?:#\d+\s+\|\s+)?(?:https?:\/\/\S+|local:\S+)\s+\|\s+([^|]+)\s+\|\s+([^|]+)/);
      const table = line.match(/^\|\s*[^|]+\s*\|\s*[^|]+\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
      const match = pending || table;
      if (!match) continue;
      const company = cleanText(match[1]).toLowerCase();
      const title = cleanText(match[2]).toLowerCase();
      if (company && title && company !== 'company') companyRoles.add(`${company}::${title}`);
    }
  }

  return { urls, companyRoles };
}

export function filterRankAndDedupe(rawJobs, source, seen = loadSeen()) {
  const addedThisRun = new Set();
  return rawJobs
    .map((job) => {
      const normalized = { ...job, url: normalizeUrl(job.url), source };
      const location = classifyLocation(normalized);
      const score = scoreJob(normalized);
      return {
        ...normalized,
        score,
        fitLabel: location.reason === 'remote' ? 'REMOTE PRIORITY' : fitLabel(score),
        locationPriority: location.priority,
        locationRank: location.rank,
        locationReason: location.reason,
      };
    })
    .filter((job) => job.locationRank < 99)
    .filter((job) => !seen.urls.has(job.url))
    .filter((job) => {
      const key = jobKey(job);
      if (seen.companyRoles.has(key) || addedThisRun.has(key)) return false;
      addedThisRun.add(key);
      return true;
    })
    .sort((a, b) => a.locationRank - b.locationRank || b.score - a.score);
}

function ensurePipeline() {
  mkdirSync('data', { recursive: true });
  if (!existsSync(PIPELINE_PATH)) {
    writeFileSync(PIPELINE_PATH, '## Pendientes\n\n## Procesadas\n', 'utf8');
  }
}

export function appendToPipeline(jobs) {
  if (jobs.length === 0) return;
  ensurePipeline();
  let text = readFileSync(PIPELINE_PATH, 'utf8');
  const marker = '## Pendientes';
  const processedMarker = '## Procesadas';
  const block = '\n' + jobs.map((job) =>
    `- [ ] ${job.url} | ${cleanText(job.company)} | ${cleanText(job.title)}`
  ).join('\n') + '\n';

  const idx = text.indexOf(marker);
  if (idx === -1) {
    const processedIdx = text.indexOf(processedMarker);
    const insertAt = processedIdx === -1 ? text.length : processedIdx;
    text = `${text.slice(0, insertAt)}\n${marker}\n${block}\n${text.slice(insertAt)}`;
  } else {
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf8');
}

export function appendToScanHistory(jobs, date = new Date().toISOString().slice(0, 10)) {
  if (jobs.length === 0) return;
  mkdirSync('data', { recursive: true });
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf8');
  }
  const lines = jobs.map((job) =>
    `${job.url}\t${date}\t${job.source}\t${cleanText(job.title)}\t${cleanText(job.company)}\tadded`
  ).join('\n') + '\n';
  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf8');
}

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const [key, inlineValue] = arg.slice(2).split('=');
      out[key] = inlineValue ?? (args[i + 1]?.startsWith('--') ? true : args[++i] ?? true);
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node portal-assist.mjs login linkedin|indeed
  node portal-assist.mjs capture linkedin|indeed --url "<search-url>" [--pages 1] [--scrolls 4] [--detail-limit 25] [--storage-state storage/linkedin_state.json] [--headless true|false] [--dry-run] [--no-notify]
`);
}

function profileDir(portal) {
  return path.resolve(PROFILE_ROOT, portal);
}

async function login(portal) {
  mkdirSync(profileDir(portal), { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir(portal), {
    headless: false,
    viewport: null,
  });
  const page = context.pages()[0] || await context.newPage();
  const home = portal === 'linkedin' ? 'https://www.linkedin.com/login' : 'https://www.indeed.com/account/login';
  await page.goto(home, { waitUntil: 'domcontentloaded' });
  console.log(`Log in to ${portal} in the opened browser. Close the browser window when you are done.`);
  await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
  await context.close().catch(() => {});
}

function boolOption(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  return !/^(false|0|no|off)$/i.test(String(value));
}

async function openContext(portal, options) {
  const slowMo = Math.max(Number(options['slow-mo'] || 0), 0);
  const headless = boolOption(options.headless, false) && !boolOption(options.headed, false);
  const viewport = headless ? { width: 1440, height: 1000 } : null;
  if (options['storage-state']) {
    const browser = await chromium.launch({ headless, slowMo });
    const context = await browser.newContext({
      storageState: String(options['storage-state']),
      viewport,
    });
    return { context, close: async () => browser.close() };
  }

  mkdirSync(profileDir(portal), { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir(portal), {
    headless,
    slowMo,
    viewport,
  });
  return { context, close: async () => context.close() };
}

async function scrollResults(page, scrolls, actionDelayMs = DEFAULT_ACTION_DELAY_MS) {
  const selectors = [
    '.jobs-search-results-list',
    '.scaffold-layout__list',
    '[data-testid="jobsearch-ResultsList"]',
    '.jobsearch-ResultsList',
  ];

  for (let i = 0; i < scrolls; i += 1) {
    let scrolled = false;
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count().catch(() => 0)) {
        await locator.evaluate((el) => el.scrollTo(0, el.scrollHeight)).catch(() => {});
        scrolled = true;
        break;
      }
    }
    if (!scrolled) await page.mouse.wheel(0, 3500).catch(() => {});
    await page.waitForTimeout(randomDelay(actionDelayMs));
  }
}

async function collectVisibleJobsDuringScroll(page, portal, scrolls, actionDelayMs) {
  const jobsByUrl = new Map();
  const rounds = Math.max(scrolls, 1);

  for (let i = 0; i <= rounds; i += 1) {
    const result = await page.evaluate(extractionScript(portal), portal);
    for (const job of result.jobs) {
      const normalizedUrl = normalizeUrl(job.url);
      if (!jobsByUrl.has(normalizedUrl)) {
        jobsByUrl.set(normalizedUrl, { ...job, url: normalizedUrl });
      }
    }

    if (i < rounds) {
      await scrollResults(page, 1, actionDelayMs);
    }
  }

  const finalResult = await page.evaluate(extractionScript(portal), portal);
  return {
    pageTitle: finalResult.pageTitle,
    pageUrl: finalResult.pageUrl,
    jobs: [...jobsByUrl.values()],
  };
}

async function extractDetailFromPage(page, portal) {
  return page.evaluate((portalName) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const pick = (selectors) => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        const text = clean(el?.innerText || el?.textContent);
        if (text) return text;
      }
      return '';
    };

    const configs = {
      linkedin: {
        title: ['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', 'h1'],
        company: ['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name'],
        location: [
          '.job-details-jobs-unified-top-card__primary-description-container',
          '.jobs-unified-top-card__primary-description-container',
          '.jobs-unified-top-card__bullet',
          '[class*="top-card"] [class*="location"]',
        ],
        description: ['.jobs-description-content__text', '.jobs-box__html-content', '#job-details'],
      },
      indeed: {
        title: ['[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title', 'h1'],
        company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', '.jobsearch-InlineCompanyRating-companyHeader'],
        location: ['[data-testid="job-location"]', '[data-testid="inlineHeader-companyLocation"]', '#jobLocationText', '.jobsearch-JobInfoHeader-subtitle'],
        description: ['#jobDescriptionText', '[data-testid="jobsearch-JobComponent-description"]'],
      },
    };

    const cfg = configs[portalName];
    const bodyText = clean(document.body?.innerText || '').slice(0, 2000);
    const description = pick(cfg.description);
    return {
      title: pick(cfg.title),
      company: pick(cfg.company),
      detailLocation: pick(cfg.location),
      description: description.slice(0, 2000),
      easyApply: /easy apply/i.test(bodyText),
      snippet: bodyText,
    };
  }, portal);
}

async function enrichLinkedInJob(page, job) {
  const jobId = normalizeUrl(job.url).match(/\/jobs\/view\/(\d+)\//)?.[1];
  const candidates = [
    jobId ? page.locator(`[data-job-id="${jobId}"]`).first() : null,
    page.locator(`a[href*="${jobId || job.url}"]`).first(),
    page.locator(`a[href*="${jobId || ''}"]`).first(),
  ].filter(Boolean);

  for (const locator of candidates) {
    if (await locator.count().catch(() => 0)) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(randomDelay(DEFAULT_ACTION_DELAY_MS));
      const detail = await extractDetailFromPage(page, 'linkedin').catch(() => ({}));
      return mergeDetail(job, detail);
    }
  }

  const detailPage = await page.context().newPage();
  try {
    await detailPage.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await detailPage.waitForTimeout(randomDelay(DEFAULT_ACTION_DELAY_MS));
    const detail = await extractDetailFromPage(detailPage, 'linkedin').catch(() => ({}));
    return mergeDetail(job, detail);
  } finally {
    await detailPage.close().catch(() => {});
  }
}

async function enrichIndeedJob(page, job) {
  const detailPage = await page.context().newPage();
  try {
    await detailPage.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await detailPage.waitForTimeout(randomDelay(DEFAULT_ACTION_DELAY_MS));
    const detail = await extractDetailFromPage(detailPage, 'indeed').catch(() => ({}));
    return mergeDetail(job, detail);
  } finally {
    await detailPage.close().catch(() => {});
  }
}

function locationFromDetail(detailLocation, fallbackLocation) {
  const cleaned = cleanText(detailLocation);
  if (!cleaned) return fallbackLocation;
  const parts = cleaned
    .split(/\s{2,}| · | \| |\n/)
    .map(cleanText)
    .filter(Boolean);
  const locationLike = parts.find((part) =>
    /remote|united states|usa|u\.s\.|dallas|plano|irving|frisco|fort worth|texas|\btx\b|austin|houston|san antonio/i.test(part)
  );
  return locationLike || cleaned || fallbackLocation;
}

function mergeDetail(job, detail = {}) {
  const detailLocation = locationFromDetail(detail.detailLocation, job.location);
  const snippet = cleanText(`${detail.description || ''} ${detail.snippet || ''} ${job.snippet || ''}`).slice(0, 2500);
  return {
    ...job,
    title: cleanText(detail.title) || job.title,
    company: cleanText(detail.company) || job.company,
    location: detailLocation || job.location,
    detailLocation: cleanText(detail.detailLocation),
    snippet,
    easyApply: typeof detail.easyApply === 'boolean' ? detail.easyApply || job.easyApply : job.easyApply,
  };
}

async function enrichJobDetails(page, portal, jobs, detailLimit) {
  const enriched = [];
  const limit = Math.min(jobs.length, detailLimit);
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    if (i >= limit) {
      enriched.push(job);
      continue;
    }
    try {
      const detailed = portal === 'linkedin'
        ? await enrichLinkedInJob(page, job)
        : await enrichIndeedJob(page, job);
      enriched.push(detailed);
    } catch {
      enriched.push(job);
    }
  }
  return enriched;
}

async function clickNext(page, portal) {
  const candidates = portal === 'linkedin'
    ? [
        page.getByRole('button', { name: /^next/i }).last(),
        page.locator('button[aria-label*="Next"]').last(),
      ]
    : [
        page.getByRole('link', { name: /^next/i }).last(),
        page.locator('a[aria-label*="Next"]').last(),
      ];

  for (const locator of candidates) {
    if (await locator.count().catch(() => 0)) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 5000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);
      return true;
    }
  }
  return false;
}

export async function runCapture(portal, options) {
  if (!options.url) throw new Error('capture requires --url');
  const pages = Math.min(Math.max(Number(options.pages || 1), 1), MAX_PAGES);
  const scrolls = Math.max(Number(options.scrolls || DEFAULT_SCROLLS), 0);
  const detailLimit = Math.max(Number(options['detail-limit'] || DEFAULT_DETAIL_LIMIT), 0);
  const actionDelayMs = Math.max(Number(options['action-delay-ms'] || DEFAULT_ACTION_DELAY_MS), 0);
  const dryRun = Boolean(options['dry-run']);
  const collectOnly = Boolean(options['collect-only']);
  const noNotify = Boolean(options['no-notify']);

  const opened = await openContext(portal, options);
  const { context } = opened;
  const page = context.pages()[0] || await context.newPage();
  const rawJobs = [];

  try {
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(randomDelay(Number(options['search-delay-ms'] || DEFAULT_SEARCH_DELAY_MS)));

    for (let pageNum = 1; pageNum <= pages; pageNum += 1) {
      const result = await collectVisibleJobsDuringScroll(page, portal, scrolls, actionDelayMs);
      console.log(`Captured ${result.jobs.length} cards across scrolls from ${portal} page ${pageNum}: ${result.pageTitle}`);
      const detailedJobs = await enrichJobDetails(page, portal, result.jobs, detailLimit);
      rawJobs.push(...detailedJobs);
      if (pageNum < pages) {
        const moved = await clickNext(page, portal);
        if (!moved) break;
      }
    }
  } finally {
    await opened.close();
  }

  const jobs = filterRankAndDedupe(rawJobs, portal);
  if (!dryRun && !collectOnly) {
    appendToPipeline(jobs);
    appendToScanHistory(jobs);
    if (!noNotify && jobs.length > 0) {
      const notifyResult = await notifyJobs(jobs);
      console.log(JSON.stringify(notifyResult, null, 2));
    }
  }

  console.log(`\n${portal} capture summary`);
  console.log(`Visible cards: ${rawJobs.length}`);
  console.log(`New Remote/Dallas/Texas matches: ${jobs.length}`);
  for (const job of jobs) {
    const easy = typeof job.easyApply === 'boolean' ? ` | Easy Apply: ${job.easyApply ? 'yes' : 'no'}` : '';
    const posted = job.postedText ? ` | Posted: ${job.postedText}` : '';
    const priority = job.locationPriority ? ` | ${job.locationPriority}` : '';
    console.log(`+ ${job.score}/100${priority} ${job.company} | ${job.title} | ${job.location || 'N/A'}${posted}${easy} | ${job.url}`);
  }
  if (dryRun) console.log('\nDry run only. Re-run without --dry-run to save and notify.');
  return jobs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const portal = args._[1];

  if (!['login', 'capture'].includes(command) || !['linkedin', 'indeed'].includes(portal)) {
    usage();
    process.exit(1);
  }

  if (command === 'login') await login(portal);
  if (command === 'capture') await runCapture(portal, args);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`portal-assist failed: ${err.message}`);
    process.exit(1);
  });
}
