#!/usr/bin/env node

import 'dotenv/config';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { chromium } from 'playwright';
import { normalizeUrl } from './portal-assist.mjs';

const PROFILE_PATH = 'config/profile.yml';
const PIPELINE_PATH = 'data/pipeline.md';
const BROWSER_ROOT = '.browser-profiles';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function loadProfile() {
  if (!existsSync(PROFILE_PATH)) throw new Error(`${PROFILE_PATH} not found`);
  return yaml.load(readFileSync(PROFILE_PATH, 'utf8'));
}

function firstPendingJob() {
  if (!existsSync(PIPELINE_PATH)) throw new Error(`${PIPELINE_PATH} not found`);
  const text = readFileSync(PIPELINE_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^- \[ \]\s+(\S+)\s+\|\s+([^|]+)\s+\|\s+(.+)$/);
    if (match) {
      return {
        url: match[1],
        company: clean(match[2]),
        title: clean(match[3]),
      };
    }
  }
  throw new Error('No pending jobs found in data/pipeline.md');
}

function findJobByUrl(url) {
  if (!existsSync(PIPELINE_PATH)) return { url, company: '', title: '' };
  const normalized = normalizeUrl(url);
  const text = readFileSync(PIPELINE_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^- \[[ x!]\]\s+(\S+)\s+\|\s+([^|]+)\s+\|\s+(.+)$/);
    if (match && normalizeUrl(match[1]) === normalized) {
      return { url: match[1], company: clean(match[2]), title: clean(match[3]) };
    }
  }
  return { url, company: '', title: '' };
}

function latestManifestRows() {
  if (!existsSync('output')) return [];
  const dirs = readdirSync('output', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join('output', entry.name))
    .sort()
    .reverse();

  const rows = [];
  for (const dir of dirs) {
    const manifest = path.join(dir, 'manifest.tsv');
    if (!existsSync(manifest)) continue;
    const lines = readFileSync(manifest, 'utf8').trim().split(/\r?\n/);
    const header = lines.shift()?.split('\t') || [];
    for (const line of lines) {
      const cols = line.split('\t');
      const row = Object.fromEntries(header.map((key, index) => [key, cols[index] || '']));
      rows.push(row);
    }
  }
  return rows;
}

function findResumePdf(job) {
  const normalized = normalizeUrl(job.url || '');
  const rows = latestManifestRows();
  const exact = rows.find((row) => normalizeUrl(row.url || '') === normalized && existsSync(row.pdf || ''));
  if (exact) return exact.pdf;

  const company = clean(job.company).toLowerCase();
  const title = clean(job.title).toLowerCase();
  const fuzzy = rows.find((row) =>
    existsSync(row.pdf || '') &&
    clean(row.company).toLowerCase() === company &&
    clean(row.title).toLowerCase() === title
  );
  return fuzzy?.pdf || '';
}

function buildFieldValues(profile, job) {
  const candidate = profile.candidate || {};
  const location = profile.location || {};
  const compensation = profile.compensation || {};
  const [firstName, ...rest] = clean(candidate.full_name).split(' ');
  const lastName = rest.join(' ');

  return {
    fullName: clean(candidate.full_name),
    firstName,
    lastName,
    email: clean(candidate.email),
    phone: clean(candidate.phone),
    location: clean(candidate.location || `${location.city || ''}, ${location.state || ''}`),
    linkedin: clean(candidate.linkedin),
    github: clean(candidate.github),
    portfolio: clean(candidate.portfolio_url),
    visa: clean(location.visa_status || 'H1B'),
    sponsorship: 'Yes, I currently work on H1B and require employer sponsorship/transfer.',
    salary: clean(compensation.target_range || compensation.minimum || ''),
    workAuth: clean(location.visa_status || 'H1B'),
    summary: `I am a senior Android/Kotlin engineer based in Dallas, TX, with 11+ years of mobile engineering experience and a current focus on AI agents, AI-assisted development, mobile platform foundations, CI/CD, security, and production reliability. I am interested in ${job.title || 'this role'} at ${job.company || 'your company'} because it matches my Android, platform, automation, and AI engineering background.`,
  };
}

function browserProfileForUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes('linkedin.com')) return path.resolve(BROWSER_ROOT, 'linkedin');
  if (lower.includes('indeed.com')) return path.resolve(BROWSER_ROOT, 'indeed');
  return path.resolve(BROWSER_ROOT, 'apply-assist');
}

async function openApplyFlow(page) {
  const candidates = [
    page.getByRole('button', { name: /^(easy apply|apply now|apply|apply for this job)$/i }).first(),
    page.getByRole('link', { name: /^(easy apply|apply now|apply|apply for this job)$/i }).first(),
    page.locator('a,button').filter({ hasText: /^(easy apply|apply now|apply|apply for this job)$/i }).first(),
  ];

  for (const locator of candidates) {
    if (await locator.count().catch(() => 0)) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 5000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(3000);
      return true;
    }
  }
  return false;
}

async function fillTextFields(page, values) {
  return page.evaluate((fieldValues) => {
    const cleanLabel = (el) => {
      const id = el.getAttribute('id');
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('name') ||
        (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText : '') ||
        el.closest('label')?.innerText ||
        '';
      return String(label).replace(/\s+/g, ' ').trim().toLowerCase();
    };
    const visible = (el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const assign = (el, value) => {
      if (!value || el.disabled || el.readOnly || !visible(el)) return false;
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const choose = (label) => {
      if (/first/.test(label) && /name/.test(label)) return fieldValues.firstName;
      if (/last/.test(label) && /name/.test(label)) return fieldValues.lastName;
      if (/full|legal/.test(label) && /name/.test(label)) return fieldValues.fullName;
      if (/e-?mail/.test(label)) return fieldValues.email;
      if (/phone|mobile/.test(label)) return fieldValues.phone;
      if (/linkedin/.test(label)) return fieldValues.linkedin;
      if (/github/.test(label)) return fieldValues.github;
      if (/portfolio|website|personal site/.test(label)) return fieldValues.portfolio;
      if (/city|location|address/.test(label)) return fieldValues.location;
      if (/salary|compensation|expected pay/.test(label)) return fieldValues.salary;
      if (/visa|work authorization|employment authorization/.test(label)) return fieldValues.workAuth;
      if (/sponsor/.test(label)) return fieldValues.sponsorship;
      if (/cover|why|summary|additional information|tell us/.test(label)) return fieldValues.summary;
      return '';
    };

    const filled = [];
    for (const el of [...document.querySelectorAll('input:not([type=file]), textarea')]) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(type)) continue;
      const label = cleanLabel(el);
      const value = choose(label);
      if (assign(el, value)) filled.push(label || type || el.tagName.toLowerCase());
    }
    return filled;
  }, values);
}

async function uploadResume(page, pdfPath) {
  if (!pdfPath) return [];
  const absolute = path.resolve(pdfPath);
  const uploads = [];
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const meta = await input.evaluate((el) => {
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('name') ||
        el.getAttribute('accept') ||
        el.closest('label')?.innerText ||
        '';
      return String(label).toLowerCase();
    }).catch(() => '');
    if (meta && !/resume|cv|pdf|upload|file|application/.test(meta)) continue;
    await input.setInputFiles(absolute).catch(() => {});
    uploads.push(meta || `file input ${i + 1}`);
  }
  return uploads;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.first && !args.url) {
    console.log('Usage: node apply-assist.mjs --first | --url "<job-url>"');
    process.exit(1);
  }

  const profile = loadProfile();
  const job = args.first ? firstPendingJob() : findJobByUrl(args.url);
  const pdf = args.pdf || findResumePdf(job);
  const values = buildFieldValues(profile, job);

  const context = await chromium.launchPersistentContext(browserProfileForUrl(job.url), {
    headless: false,
    viewport: null,
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(3000);
    const opened = await openApplyFlow(page);
    const fields = await fillTextFields(page, values);
    const uploads = await uploadResume(page, pdf);

    console.log(`Application assist ready for ${job.company || 'company'} | ${job.title || 'role'}`);
    console.log(`Opened apply flow: ${opened ? 'yes' : 'not detected'}`);
    console.log(`Fields filled: ${fields.length ? fields.join(', ') : 'none detected'}`);
    console.log(`Resume uploaded: ${uploads.length ? `${pdf} (${uploads.join(', ')})` : 'not uploaded'}`);
    console.log('Review every field in the browser. I stopped before final Submit/Send/Apply.');
    console.log('Close the browser window when you are done.');
    await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
  } finally {
    await context.close().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`apply-assist failed: ${err.message}`);
    process.exit(1);
  });
}
