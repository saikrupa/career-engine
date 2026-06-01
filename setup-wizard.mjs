#!/usr/bin/env node

import 'dotenv/config';
import http from 'http';
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SETUP_WIZARD_PORT || 4321);
const SECRET_KEYS = [
  'GEMINI_API_KEY',
  'SLACK_WEBHOOK_URL',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'LINKEDIN_STORAGE_STATE',
];
const DASHBOARD_STATUS_PATH = 'data/dashboard-status.json';
const LAST_RUN_PATH = 'output/last-alert-run.json';
let activeRun = null;
let activeRunId = 0;
let runState = {
  running: false,
  portal: '',
  phase: 'Idle',
  detail: 'Ready',
  updatedAt: '',
  exitCode: null,
};

function fromRoot(...parts) {
  return path.join(ROOT, ...parts);
}

function readText(file, fallback = '') {
  try {
    return readFileSync(fromRoot(file), 'utf8');
  } catch {
    return fallback;
  }
}

function ensureDir(file) {
  mkdirSync(path.dirname(fromRoot(file)), { recursive: true });
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    env[line.slice(0, index).trim()] = line.slice(index + 1);
  }
  return env;
}

function writeEnv(updates) {
  const envPath = fromRoot('.env');
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const env = parseEnv(existing);
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && String(value).trim()) env[key] = String(value).trim();
  }
  const keys = Array.from(new Set([...Object.keys(env), ...SECRET_KEYS])).sort();
  const lines = [
    '# Local secrets for Career-Engine. This file is gitignored.',
    '# Leave values blank for integrations you do not use yet.',
    '',
    ...keys.map((key) => `${key}=${env[key] || ''}`),
    '',
  ];
  writeFileSync(envPath, lines.join('\n'), 'utf8');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(fromRoot(file), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(file);
  writeFileSync(fromRoot(file), JSON.stringify(value, null, 2), 'utf8');
}

function splitList(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueList(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeResumeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fileExtension(fileName) {
  return path.extname(String(fileName || '')).toLowerCase();
}

function extractTextWithTextutil(buffer, extension) {
  const tempName = `career-engine-resume-${Date.now()}-${Math.random().toString(36).slice(2)}${extension || '.tmp'}`;
  const tempPath = path.join(os.tmpdir(), tempName);
  writeFileSync(tempPath, buffer);
  try {
    return execFileSync('textutil', ['-convert', 'txt', '-stdout', tempPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    unlinkSync(tempPath);
  }
}

async function extractResumeText(input) {
  if (input.cvText?.trim()) {
    return normalizeResumeText(input.cvText);
  }
  if (!input.resumeFileBase64 || !input.resumeFileName) {
    return '';
  }

  const ext = fileExtension(input.resumeFileName);
  const buffer = Buffer.from(String(input.resumeFileBase64), 'base64');
  let extracted = '';

  if (ext === '.pdf') {
    const module = await import('pdf-parse');
    const pdfParse = module.default || module;
    const parsed = await pdfParse(buffer);
    extracted = parsed?.text || '';
  } else if (ext === '.doc' || ext === '.docx' || ext === '.rtf') {
    try {
      extracted = extractTextWithTextutil(buffer, ext);
    } catch {
      throw new Error('DOC/DOCX parsing requires macOS textutil. Paste resume text if conversion fails.');
    }
  } else if (ext === '.txt' || ext === '.md') {
    extracted = buffer.toString('utf8');
  } else {
    throw new Error('Unsupported resume file type. Use PDF, DOC, DOCX, TXT, or MD.');
  }

  const normalized = normalizeResumeText(extracted);
  if (!normalized) {
    throw new Error('Could not extract readable text from the uploaded resume file.');
  }
  return normalized;
}

function writeProfile(input) {
  ensureDir('config/profile.yml');
  const primaryRoles = splitList(input.targetRoles);
  const profile = {
    candidate: {
      full_name: input.fullName || '',
      email: input.email || '',
      phone: input.phone || '',
      location: input.location || '',
      linkedin: input.linkedin || '',
      portfolio_url: input.portfolioUrl || '',
      github: input.github || '',
      twitter: '',
    },
    target_roles: {
      primary: primaryRoles,
      archetypes: primaryRoles.slice(0, 4).map((role, index) => ({
        name: role,
        level: index === 0 ? 'Target' : 'Adjacent',
        fit: index === 0 ? 'primary' : 'secondary',
      })),
    },
    narrative: {
      headline: input.headline || '',
      exit_story: input.careerStory || '',
      superpowers: splitList(input.superpowers),
      proof_points: [],
    },
    compensation: {
      target_range: input.salaryRange || '',
      currency: input.currency || 'USD',
      minimum: input.minimumSalary || '',
      location_flexibility: input.locationFlexibility || '',
    },
    location: {
      country: input.country || '',
      city: input.city || '',
      timezone: input.timezone || '',
      visa_status: input.visaStatus || '',
    },
    cv: {
      output_format: 'html',
    },
  };
  writeFileSync(fromRoot('config/profile.yml'), yaml.dump(profile, { lineWidth: 100 }), 'utf8');
}

function writeJobAlerts(input) {
  ensureDir('config/job-alerts.yml');
  const keywords = splitList(input.keywords);
  const usLocations = splitList(input.usLocations);
  const indiaLocations = splitList(input.indiaLocations);
  const activeCountries = uniqueList([
    input.countryUS ? 'us' : '',
    input.countryIndia ? 'india' : '',
  ]);
  const fallbackUsLocations = ['Remote United States', 'Dallas, TX', 'Texas'];
  const fallbackIndiaLocations = ['Remote India', 'Bengaluru, India', 'Hyderabad, India'];
  const finalUsLocations = usLocations.length > 0 ? usLocations : fallbackUsLocations;
  const finalIndiaLocations = indiaLocations.length > 0 ? indiaLocations : fallbackIndiaLocations;
  const combinedLocations = [...finalUsLocations, ...finalIndiaLocations];
  const config = {
    enabled: true,
    interval_minutes: Number(input.intervalMinutes || 30),
    active_countries: activeCountries.length > 0 ? activeCountries : ['us'],
    portals: {
      linkedin: Boolean(input.portalLinkedin),
      indeed: Boolean(input.portalIndeed),
      dice: Boolean(input.portalDice),
      naukri: Boolean(input.portalNaukri),
    },
    country_portals: {
      us: ['linkedin', 'indeed', 'dice'],
      india: ['linkedin', 'indeed', 'naukri'],
    },
    session: {},
    country_locations: {
      us: finalUsLocations,
      india: finalIndiaLocations,
    },
    locations: {
      remote: combinedLocations.filter((item) => /remote/i.test(item)),
      local: combinedLocations.filter((item) => !/remote|texas$/i.test(item)),
      texas: combinedLocations.filter((item) => /^texas$/i.test(item)),
    },
    search_radius: {
      dallas_miles: 80,
      texas_miles: null,
      default_miles: null,
    },
    keywords,
    thresholds: {
      default_min_score: Number(input.minScore || 50),
      alert_all_android: false,
    },
    actions: {
      add_to_pipeline: true,
      notify: Boolean(input.enableNotifications),
      generate_tailored_resumes: Boolean(input.generateResumes),
    },
    notifications: {
      slack_channel_by_portal: {},
    },
    capture: {
      headless: true,
      pages: 1,
      scrolls: 4,
      detail_limit: 10,
      search_delay_ms: 3000,
      action_delay_ms: 1600,
      between_search_delay_ms: 3500,
      slow_mo: 0,
      portal_overrides: {
        indeed: {
          headless: false,
          pages: 1,
          scrolls: 2,
          search_delay_ms: 4500,
          action_delay_ms: 2200,
          slow_mo: 200,
        },
        naukri: {
          headless: false,
          pages: 1,
          scrolls: 3,
          search_delay_ms: 4500,
          action_delay_ms: 2200,
          slow_mo: 200,
        },
      },
    },
    validation: {
      require_portal_login: true,
      skip_unconfigured_portals: true,
    },
  };
  if (input.linkedinStorageState) config.session.linkedin_storage_state = input.linkedinStorageState;
  if (input.diceSlackChannelId) config.notifications.slack_channel_by_portal.dice = input.diceSlackChannelId;
  writeFileSync(fromRoot('config/job-alerts.yml'), yaml.dump(config, { lineWidth: 100 }), 'utf8');
}

function ensureBasics(input, cvText) {
  if (!existsSync(fromRoot('modes/_profile.md')) && existsSync(fromRoot('modes/_profile.template.md'))) {
    copyFileSync(fromRoot('modes/_profile.template.md'), fromRoot('modes/_profile.md'));
  }
  if (!existsSync(fromRoot('portals.yml')) && existsSync(fromRoot('templates/portals.example.yml'))) {
    copyFileSync(fromRoot('templates/portals.example.yml'), fromRoot('portals.yml'));
  }
  if (!existsSync(fromRoot('data/applications.md'))) {
    ensureDir('data/applications.md');
    writeFileSync(
      fromRoot('data/applications.md'),
      '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n',
      'utf8'
    );
  }
  if (cvText?.trim()) writeFileSync(fromRoot('cv.md'), cvText.trim() + '\n', 'utf8');
}

function status() {
  const env = parseEnv(readText('.env'));
  return {
    files: {
      cv: existsSync(fromRoot('cv.md')),
      profile: existsSync(fromRoot('config/profile.yml')),
      profileMode: existsSync(fromRoot('modes/_profile.md')),
      portals: existsSync(fromRoot('portals.yml')),
      jobAlerts: existsSync(fromRoot('config/job-alerts.yml')),
      env: existsSync(fromRoot('.env')),
    },
    browserProfiles: {
      linkedin: existsSync(fromRoot('.browser-profiles/linkedin')),
      indeed: existsSync(fromRoot('.browser-profiles/indeed')),
      dice: existsSync(fromRoot('.browser-profiles/dice')),
      naukri: existsSync(fromRoot('.browser-profiles/naukri')),
    },
    secrets: Object.fromEntries(SECRET_KEYS.map((key) => [key, Boolean(env[key])])),
  };
}

function jobKey(job) {
  return `${job.url || ''}::${job.company || ''}::${job.title || ''}`;
}

function dashboardStatuses() {
  return readJson(DASHBOARD_STATUS_PATH, {});
}

function latestResults() {
  const summary = readJson(LAST_RUN_PATH, null);
  const statuses = dashboardStatuses();
  const jobs = (summary?.jobs || []).map((job) => {
    const key = jobKey(job);
    return {
      key,
      company: job.company || '',
      title: job.title || '',
      source: job.source || '',
      url: job.url || '',
      score: job.score ?? '',
      location: job.location || '',
      resumePdf: job.resume?.pdf || job.resume?.pdfPath || '',
      applied: Boolean(statuses[key]?.applied),
    };
  });
  return {
    summary: summary ? {
      updatedAt: summary.updatedAt,
      totalNew: summary.totalNew,
      portals: summary.portals || [],
      skipped: summary.skipped || [],
      failures: summary.failures || [],
      notifications: summary.notifications || [],
    } : null,
    jobs,
  };
}

function updateRunState(next) {
  runState = {
    ...runState,
    ...next,
    updatedAt: new Date().toISOString(),
  };
}

function lineToProgress(line) {
  const text = String(line || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  if (!text) return null;
  const search = text.match(/^Search\s+(\d+)\/(\d+):\s+([^|]+)\s+\|\s+([^|]+)\s+\|\s+(.+)$/);
  if (search) {
    return {
      phase: `Search ${search[1]} of ${search[2]}`,
      detail: `${search[3].trim()}: searching "${search[4].trim()}" in ${search[5].trim()}`,
    };
  }
  const captured = text.match(/^Captured\s+(\d+)\s+cards.*from\s+(\w+)/);
  if (captured) return { phase: 'Reading results', detail: `${captured[2]} returned ${captured[1]} visible cards` };
  const filtered = text.match(/^Score filter:\s+kept\s+(\d+)\/(\d+)\s+from\s+(.+)$/);
  if (filtered) return { phase: 'Filtering matches', detail: `Kept ${filtered[1]} of ${filtered[2]} from ${filtered[3]}` };
  const generated = text.match(/^Generated\s+(\d+)\s+tailored resume PDF/);
  if (generated) return { phase: 'Generating resumes', detail: `Created ${generated[1]} tailored resume PDF(s)` };
  const complete = text.match(/^Job alert suite complete\.\s+New actionable jobs:\s+(\d+)/);
  if (complete) return { phase: 'Complete', detail: `${complete[1]} actionable job(s) found` };
  if (/Preflight skipped portals/.test(text)) return { phase: 'Preflight', detail: 'Skipping unconfigured portals' };
  if (/^-\s+\w+:/.test(text)) return { phase: 'Preflight', detail: text.replace(/^- /, '') };
  if (/failed|error|blocked/i.test(text)) return { phase: 'Attention needed', detail: text.slice(0, 220) };
  return null;
}

function startRun(portal = 'all') {
  if (activeRun) throw new Error('A scan is already running.');
  const args = ['job-alert-suite.mjs', 'once'];
  if (portal && portal !== 'all') args.push('--portal', portal);
  activeRunId += 1;
  updateRunState({
    running: true,
    portal,
    phase: 'Starting',
    detail: portal === 'all' ? 'Starting all enabled portals' : `Starting ${portal}`,
    exitCode: null,
  });
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  activeRun = child;
  const handleChunk = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const progress = lineToProgress(line);
      if (progress) updateRunState(progress);
    }
  };
  child.stdout.on('data', handleChunk);
  child.stderr.on('data', handleChunk);
  child.on('close', (code) => {
    activeRun = null;
    updateRunState({
      running: false,
      exitCode: code,
      phase: code === 0 ? runState.phase : 'Run failed',
      detail: code === 0 ? runState.detail : `The scan exited with code ${code}`,
    });
  });
}

function startPortalLogin(portal) {
  if (!['linkedin', 'indeed', 'dice', 'naukri'].includes(portal)) {
    throw new Error('Unsupported portal');
  }
  const child = spawn(process.execPath, ['portal-assist.mjs', 'login', portal], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function html() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Career-Engine</title>
  <style>
    :root { color-scheme: light; --ink: #18212f; --muted: #647181; --line: #dbe2ea; --bg: #f4f7fb; --panel: #fff; --soft: #f8fafc; --accent: #1769e0; --accent-ink: #fff; --ok: #18794e; --warn: #a45f00; --danger: #b42318; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
    .app { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    .topbar { height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 clamp(18px, 4vw, 42px); background: rgba(255,255,255,.94); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 3; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .brand-mark { width: 34px; height: 34px; border-radius: 8px; background: #17202f; color: #fff; display: grid; place-items: center; font-weight: 850; }
    .brand-title { font-size: 16px; font-weight: 850; }
    .brand-subtitle { color: var(--muted); font-size: 12px; }
    .nav { display: flex; gap: 8px; align-items: center; }
    .page { display: none; padding: 24px clamp(18px, 4vw, 42px) 40px; }
    .page.active { display: block; }
    .dashboard-grid { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 18px; align-items: start; }
    .hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: center; margin-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: clamp(28px, 4vw, 42px); letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 18px; letter-spacing: 0; }
    h3 { margin: 0; font-size: 15px; letter-spacing: 0; }
    p { margin: 0 0 14px; color: var(--muted); }
    .panel, form, aside { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
    .panel { padding: 18px; }
    .panel + .panel { margin-top: 18px; }
    section { padding: 22px; border-bottom: 1px solid var(--line); }
    section:last-child { border-bottom: 0; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    label { display: grid; gap: 6px; font-weight: 650; }
    input, textarea, select { width: 100%; border: 1px solid #b9c3cf; border-radius: 6px; padding: 10px 11px; font: inherit; background: #fff; color: var(--ink); }
    textarea { min-height: 96px; resize: vertical; }
    .wide { grid-column: 1 / -1; }
    .checks { display: flex; flex-wrap: wrap; gap: 12px; }
    .checks label { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
    input[type="checkbox"] { width: 18px; height: 18px; }
    .hint { color: var(--muted); font-size: 13px; font-weight: 400; }
    .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 18px 22px 22px; }
    button { border: 0; border-radius: 6px; background: var(--accent); color: var(--accent-ink); padding: 11px 16px; font-weight: 750; cursor: pointer; min-height: 40px; }
    button.secondary { background: #e9eef5; color: var(--ink); }
    button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    button.icon { width: 40px; padding: 0; display: grid; place-items: center; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .portal-grid { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)); gap: 12px; margin-top: 12px; }
    .portal-card { border: 1px solid var(--line); border-radius: 8px; background: var(--soft); padding: 14px; display: grid; gap: 10px; min-height: 132px; }
    .portal-card strong { font-size: 15px; }
    .portal-card button { width: 100%; }
    .metric-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
    .metric { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .metric-value { font-size: 24px; font-weight: 850; }
    .metric-label { color: var(--muted); font-size: 12px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border-top: 1px solid var(--line); padding: 10px 8px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .run-panel { display: grid; gap: 14px; }
    .progress-box { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--soft); }
    .progress-phase { font-weight: 800; margin-bottom: 4px; }
    .result-title { font-weight: 750; }
    .link-row { display: flex; gap: 10px; flex-wrap: wrap; }
    aside { align-self: start; padding: 18px; position: sticky; top: 16px; }
    .status { display: grid; gap: 8px; margin: 12px 0 18px; }
    .pill { display: flex; justify-content: space-between; gap: 12px; padding: 8px 10px; background: #f2f5f9; border-radius: 6px; color: var(--muted); }
    .pill strong { color: var(--ink); }
    .ok { color: var(--ok); font-weight: 750; }
    .warn { color: var(--warn); font-weight: 750; }
    code { background: #eef2f7; border-radius: 4px; padding: 2px 5px; }
    #result { min-height: 22px; color: var(--ok); font-weight: 700; }
    .setup-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 18px; align-items: start; }
    .setup-header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .empty { padding: 24px; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: 8px; background: var(--soft); }
    @media (max-width: 1100px) { .dashboard-grid, .setup-layout { grid-template-columns: 1fr; } aside { position: static; } .portal-grid, .metric-row { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 680px) { .topbar { height: auto; padding-top: 12px; padding-bottom: 12px; align-items: flex-start; } .nav { flex-wrap: wrap; justify-content: flex-end; } .hero, .grid, .portal-grid, .metric-row { grid-template-columns: 1fr; } table { table-layout: auto; } }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="brand">
        <div class="brand-mark">CE</div>
        <div>
          <div class="brand-title">Career-Engine</div>
          <div class="brand-subtitle">Job search command center</div>
        </div>
      </div>
      <div class="nav">
        <button type="button" class="ghost view-button" data-view="dashboard">Dashboard</button>
        <button type="button" class="secondary view-button" data-view="setup">Setup</button>
      </div>
    </div>

    <main>
      <div id="dashboardPage" class="page active">
        <div class="hero">
          <div>
            <h1>Your job search cockpit</h1>
            <p>Run portals, watch the current agent action, review matches, and download tailored resumes from one local dashboard.</p>
          </div>
          <button type="button" class="secondary view-button" data-view="setup">Setup profile</button>
        </div>
        <div class="metric-row">
          <div class="metric"><div class="metric-value" id="metricMatches">0</div><div class="metric-label">Latest matches</div></div>
          <div class="metric"><div class="metric-value" id="metricApplied">0</div><div class="metric-label">Marked applied</div></div>
          <div class="metric"><div class="metric-value" id="metricResumes">0</div><div class="metric-label">Resume PDFs</div></div>
          <div class="metric"><div class="metric-value" id="metricPortals">0</div><div class="metric-label">Runnable portals</div></div>
        </div>
        <div class="dashboard-grid">
          <div>
            <div class="panel">
              <h2>Run Search</h2>
              <p>Choose one portal or run every enabled source. The dashboard shows only the current action so it stays calm and readable.</p>
              <div class="portal-grid">
                <div class="portal-card"><strong>All Enabled</strong><span class="hint">LinkedIn, Indeed, Dice, Naukri based on setup.</span><button type="button" class="run-scan" data-portal="all">Run all</button></div>
                <div class="portal-card"><strong>LinkedIn</strong><span class="hint">Best for direct company posts and Easy Apply discovery.</span><button type="button" class="secondary run-scan" data-portal="linkedin">Run LinkedIn</button></div>
                <div class="portal-card"><strong>Indeed</strong><span class="hint">Runs slower in a visible browser to reduce bot friction.</span><button type="button" class="secondary run-scan" data-portal="indeed">Run Indeed</button></div>
                <div class="portal-card"><strong>Dice</strong><span class="hint">Strong for US contract and specialist engineering roles.</span><button type="button" class="secondary run-scan" data-portal="dice">Run Dice</button></div>
                <div class="portal-card"><strong>Naukri</strong><span class="hint">India-focused source for local and remote India roles.</span><button type="button" class="secondary run-scan" data-portal="naukri">Run Naukri</button></div>
              </div>
            </div>
            <div class="panel">
              <h2>Latest Matches</h2>
              <div id="resultsSummary" class="hint">No run results loaded yet.</div>
              <div id="emptyResults" class="empty">Run a portal to see jobs, resume PDFs, and application status here.</div>
              <table id="resultsTable" hidden>
                <thead>
                  <tr>
                    <th style="width:76px">Applied</th>
                    <th style="width:90px">Source</th>
                    <th>Job</th>
                    <th style="width:74px">Score</th>
                    <th style="width:180px">Links</th>
                  </tr>
                </thead>
                <tbody id="resultsBody"></tbody>
              </table>
            </div>
          </div>
          <aside>
            <h2>Agent Status</h2>
            <div class="progress-box">
              <div class="progress-phase" id="runPhase">Idle</div>
              <div class="hint" id="runDetail">Ready</div>
            </div>
            <div class="status" id="dashboardStatus"></div>
            <button type="button" class="secondary view-button" data-view="setup" style="width:100%">Open setup</button>
          </aside>
        </div>
      </div>

      <div id="setupPage" class="page">
        <div class="setup-header">
          <div>
            <h1>Setup</h1>
            <p>Fill this once. The app writes local, gitignored files for profile, job alerts, resume, and secrets.</p>
          </div>
          <button type="button" class="secondary view-button" data-view="dashboard">Back to dashboard</button>
        </div>
        <div class="setup-layout">
          <form id="setupForm">
      <section>
        <h2>1. Your Profile</h2>
        <div class="grid">
          <label>Full name<input name="fullName" autocomplete="name"></label>
          <label>Email<input name="email" type="email" autocomplete="email"></label>
          <label>Phone<input name="phone" autocomplete="tel"></label>
          <label>Location<input name="location" placeholder="Dallas, TX"></label>
          <label>City<input name="city" placeholder="Dallas"></label>
          <label>Country<input name="country" placeholder="United States"></label>
          <label>Timezone<input name="timezone" placeholder="America/Chicago"></label>
          <label>Visa status<input name="visaStatus" placeholder="No sponsorship needed"></label>
          <label>LinkedIn<input name="linkedin" placeholder="https://linkedin.com/in/you"></label>
          <label>GitHub<input name="github" placeholder="https://github.com/you"></label>
          <label class="wide">Portfolio<input name="portfolioUrl" placeholder="https://your-site.dev"></label>
        </div>
      </section>
      <section>
        <h2>2. Career Target</h2>
        <div class="grid">
          <label class="wide">Target roles<span class="hint">Comma or newline separated.</span><textarea name="targetRoles" placeholder="Senior Software Engineer&#10;Senior Android Engineer&#10;AI Automation Engineer"></textarea></label>
          <label>Salary target range<input name="salaryRange" placeholder="$150K-180K"></label>
          <label>Minimum salary<input name="minimumSalary" placeholder="$130K"></label>
          <label>Currency<input name="currency" value="USD"></label>
          <label>Location flexibility<input name="locationFlexibility" placeholder="Remote preferred, Dallas hybrid okay"></label>
          <label class="wide">Headline<input name="headline" placeholder="Senior software engineer with product design instincts"></label>
          <label class="wide">Superpowers<span class="hint">What should the system notice when scoring jobs?</span><textarea name="superpowers" placeholder="Mobile architecture&#10;AI workflow automation&#10;Product thinking"></textarea></label>
          <label class="wide">Career story<textarea name="careerStory" placeholder="A short recruiter-friendly story about what makes you different."></textarea></label>
        </div>
      </section>
      <section>
        <h2>3. Resume</h2>
        <label>Upload resume file (PDF, DOC, DOCX, TXT, MD)<span class="hint">Preferred. The wizard extracts text and writes <code>cv.md</code>.</span><input name="resumeFile" type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf"></label>
        <label>Or paste resume markdown/plain text<span class="hint">If provided, pasted text overrides uploaded file.</span><textarea name="cvText" style="min-height:180px"></textarea></label>
      </section>
      <section>
        <h2>4. Job Portals</h2>
        <div class="checks">
          <label><input type="checkbox" name="countryUS" checked>Target United States</label>
          <label><input type="checkbox" name="countryIndia" checked>Target India</label>
        </div>
        <div class="checks">
          <label><input type="checkbox" name="portalLinkedin" checked>LinkedIn</label>
          <label><input type="checkbox" name="portalIndeed" checked>Indeed</label>
          <label><input type="checkbox" name="portalDice" checked>Dice</label>
          <label><input type="checkbox" name="portalNaukri" checked>Naukri (India)</label>
        </div>
        <div class="actions" style="padding:14px 0 0">
          <button type="button" class="secondary portal-login" data-portal="linkedin">Log in to LinkedIn</button>
          <button type="button" class="secondary portal-login" data-portal="indeed">Log in to Indeed</button>
          <button type="button" class="secondary portal-login" data-portal="dice">Log in to Dice</button>
          <button type="button" class="secondary portal-login" data-portal="naukri">Log in to Naukri</button>
        </div>
        <div class="grid" style="margin-top:14px">
          <label class="wide">Search keywords<textarea name="keywords" placeholder="Senior Android Engineer Kotlin&#10;Android Developer Kotlin&#10;Android Engineer Jetpack Compose&#10;Mobile Android Engineer&#10;Android SDK Engineer&#10;Android Platform Engineer&#10;Kotlin Multiplatform Android&#10;Lead Android Developer&#10;Android Architect&#10;Android Architecture Engineer"></textarea></label>
          <label class="wide">US locations<textarea name="usLocations" placeholder="Remote United States&#10;Dallas, TX&#10;Texas"></textarea></label>
          <label class="wide">India locations<textarea name="indiaLocations" placeholder="Remote India&#10;Bengaluru, India&#10;Hyderabad, India"></textarea></label>
          <label>Minimum alert score<input name="minScore" type="number" min="0" max="100" value="50"></label>
          <label>Run interval minutes<input name="intervalMinutes" type="number" min="5" value="30"></label>
          <label class="wide">LinkedIn storage state path<span class="hint">Optional. Usually leave blank and run <code>npm run portal:login -- linkedin</code>.</span><input name="linkedinStorageState" placeholder=".auth/linkedin-state.json"></label>
        </div>
      </section>
      <section>
        <h2>5. Alerts And Secrets</h2>
        <div class="checks">
          <label><input type="checkbox" name="enableNotifications" checked>Send notifications</label>
          <label><input type="checkbox" name="generateResumes" checked>Generate tailored PDFs</label>
        </div>
        <div class="grid" style="margin-top:14px">
          <label class="wide">Slack webhook URL<input name="slackWebhookUrl" type="password" autocomplete="off"></label>
          <label>Slack bot token<input name="slackBotToken" type="password" autocomplete="off"></label>
          <label>Slack channel ID<input name="slackChannelId" placeholder="C0123456789"></label>
          <label>Dice Slack channel ID<input name="diceSlackChannelId" placeholder="Optional portal-specific channel"></label>
          <label>Telegram bot token<input name="telegramBotToken" type="password" autocomplete="off"></label>
          <label>Telegram chat ID<input name="telegramChatId" type="password" autocomplete="off"></label>
          <label class="wide">Gemini API key<input name="geminiApiKey" type="password" autocomplete="off"></label>
        </div>
      </section>
      <div class="actions">
        <button type="submit">Save Setup</button>
        <button type="button" class="secondary" id="dryRun">Check Status</button>
        <span id="result"></span>
      </div>
          </form>
          <aside>
            <h2>Setup Status</h2>
            <p>Secrets are shown only as present or missing. Values never leave your machine.</p>
            <div class="status" id="status"></div>
            <p>Login sessions are saved locally under <code>.browser-profiles</code>.</p>
          </aside>
        </div>
      </div>
    </main>
  </div>
  <script>
    const form = document.querySelector('#setupForm');
    const result = document.querySelector('#result');
    const statusBox = document.querySelector('#status');
    const dashboardStatusBox = document.querySelector('#dashboardStatus');
    const runPhase = document.querySelector('#runPhase');
    const runDetail = document.querySelector('#runDetail');
    const resultsSummary = document.querySelector('#resultsSummary');
    const resultsBody = document.querySelector('#resultsBody');
    const resultsTable = document.querySelector('#resultsTable');
    const emptyResults = document.querySelector('#emptyResults');
    const metricMatches = document.querySelector('#metricMatches');
    const metricApplied = document.querySelector('#metricApplied');
    const metricResumes = document.querySelector('#metricResumes');
    const metricPortals = document.querySelector('#metricPortals');
    const fields = ['portalLinkedin', 'portalIndeed', 'portalDice', 'portalNaukri', 'countryUS', 'countryIndia', 'enableNotifications', 'generateResumes'];

    function setView(view) {
      document.querySelector('#dashboardPage').classList.toggle('active', view === 'dashboard');
      document.querySelector('#setupPage').classList.toggle('active', view === 'setup');
      history.replaceState(null, '', view === 'setup' ? '#setup' : '#dashboard');
    }

    function toBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read selected resume file.'));
        reader.onload = () => {
          const result = String(reader.result || '');
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.readAsDataURL(file);
      });
    }

    async function formData() {
      const data = Object.fromEntries(new FormData(form).entries());
      for (const field of fields) data[field] = form.elements[field].checked;
      const resumeFile = form.elements.resumeFile.files?.[0];
      if (resumeFile) {
        data.resumeFileName = resumeFile.name;
        data.resumeFileType = resumeFile.type || '';
        data.resumeFileBase64 = await toBase64(resumeFile);
      }
      return data;
    }

    async function refreshStatus() {
      const res = await fetch('/api/status');
      const json = await res.json();
      statusBox.innerHTML = '';
      dashboardStatusBox.innerHTML = '';
      const readyPortals = Object.values(json.browserProfiles).filter(Boolean).length;
      metricPortals.textContent = String(readyPortals);
      for (const [name, present] of Object.entries(json.files)) {
        statusBox.insertAdjacentHTML('beforeend', '<div class="pill"><strong>' + name + '</strong><span class="' + (present ? 'ok' : 'warn') + '">' + (present ? 'ready' : 'missing') + '</span></div>');
      }
      for (const [name, present] of Object.entries(json.browserProfiles)) {
        statusBox.insertAdjacentHTML('beforeend', '<div class="pill"><strong>' + name + ' login</strong><span class="' + (present ? 'ok' : 'warn') + '">' + (present ? 'profile saved' : 'not saved') + '</span></div>');
        dashboardStatusBox.insertAdjacentHTML('beforeend', '<div class="pill"><strong>' + name + '</strong><span class="' + (present ? 'ok' : 'warn') + '">' + (present ? 'connected' : 'setup needed') + '</span></div>');
      }
      for (const [name, present] of Object.entries(json.secrets)) {
        statusBox.insertAdjacentHTML('beforeend', '<div class="pill"><strong>' + name + '</strong><span class="' + (present ? 'ok' : 'warn') + '">' + (present ? 'set' : 'blank') + '</span></div>');
      }
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    async function refreshRun() {
      const res = await fetch('/api/run/status');
      const json = await res.json();
      runPhase.textContent = json.phase || 'Idle';
      runDetail.textContent = json.detail || 'Ready';
      for (const button of document.querySelectorAll('.run-scan')) button.disabled = Boolean(json.running);
    }

    async function refreshResults() {
      const res = await fetch('/api/results');
      const json = await res.json();
      const summary = json.summary;
      resultsSummary.textContent = summary
        ? (summary.totalNew + ' actionable match(es) from ' + (summary.portals || []).join(', ') + '. Updated ' + new Date(summary.updatedAt).toLocaleString())
        : 'No run results loaded yet.';
      const jobs = json.jobs || [];
      const appliedCount = jobs.filter((job) => job.applied).length;
      const resumeCount = jobs.filter((job) => job.resumePdf).length;
      metricMatches.textContent = String(jobs.length);
      metricApplied.textContent = String(appliedCount);
      metricResumes.textContent = String(resumeCount);
      resultsTable.hidden = jobs.length === 0;
      emptyResults.hidden = jobs.length > 0;
      resultsBody.innerHTML = '';
      for (const job of jobs) {
        const resume = job.resumePdf
          ? '<a href="/file?path=' + encodeURIComponent(job.resumePdf) + '" target="_blank">Resume PDF</a>'
          : '<span class="hint">No PDF</span>';
        resultsBody.insertAdjacentHTML('beforeend',
          '<tr>' +
            '<td><input type="checkbox" class="applied-toggle" data-key="' + escapeHtml(job.key) + '"' + (job.applied ? ' checked' : '') + '></td>' +
            '<td>' + escapeHtml(job.source || 'unknown') + '</td>' +
            '<td><div class="result-title">' + escapeHtml(job.company) + '</div><div>' + escapeHtml(job.title) + '</div><div class="hint">' + escapeHtml(job.location || '') + '</div></td>' +
            '<td>' + escapeHtml(job.score) + '</td>' +
            '<td><div class="link-row"><a href="' + escapeHtml(job.url) + '" target="_blank" rel="noreferrer">Job post</a>' + resume + '</div></td>' +
          '</tr>');
      }
      for (const checkbox of document.querySelectorAll('.applied-toggle')) {
        checkbox.addEventListener('change', async () => {
          await fetch('/api/application-status', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: checkbox.dataset.key, applied: checkbox.checked }),
          });
        });
      }
    }

    for (const button of document.querySelectorAll('.view-button')) {
      button.addEventListener('click', () => setView(button.dataset.view));
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      result.textContent = 'Saving...';
      const payload = await formData();
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      result.textContent = json.ok ? 'Saved. You are ready for a dry run.' : json.error;
      await refreshStatus();
    });
    document.querySelector('#dryRun').addEventListener('click', refreshStatus);
    for (const button of document.querySelectorAll('.portal-login')) {
      button.addEventListener('click', async () => {
        result.textContent = 'Opening ' + button.dataset.portal + ' login...';
        const res = await fetch('/api/login/' + button.dataset.portal, { method: 'POST' });
        const json = await res.json();
        result.textContent = json.ok ? 'Browser opened. Log in, then close the browser window.' : json.error;
      });
    }
    for (const button of document.querySelectorAll('.run-scan')) {
      button.addEventListener('click', async () => {
        result.textContent = 'Starting scan...';
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ portal: button.dataset.portal }),
        });
        const json = await res.json();
        result.textContent = json.ok ? 'Scan started.' : json.error;
        await refreshRun();
      });
    }
    refreshStatus();
    refreshRun();
    refreshResults();
    setView(location.hash === '#setup' ? 'setup' : 'dashboard');
    setInterval(async () => {
      await refreshRun();
      const status = await (await fetch('/api/run/status')).json();
      if (!status.running) await refreshResults();
    }, 2000);
  </script>
</body>
</html>`;
}

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') return send(res, 200, 'text/html; charset=utf-8', html());
  if (req.method === 'GET' && req.url === '/api/status') {
    return send(res, 200, 'application/json', JSON.stringify(status()));
  }
  if (req.method === 'GET' && req.url === '/api/run/status') {
    return send(res, 200, 'application/json', JSON.stringify(runState));
  }
  if (req.method === 'GET' && req.url === '/api/results') {
    return send(res, 200, 'application/json', JSON.stringify(latestResults()));
  }
  if (req.method === 'GET' && req.url?.startsWith('/file?')) {
    try {
      const target = new URL(req.url, `http://127.0.0.1:${PORT}`).searchParams.get('path') || '';
      const resolved = path.resolve(ROOT, target);
      const outputRoot = path.resolve(ROOT, 'output');
      if (!resolved.startsWith(outputRoot) || !existsSync(resolved)) throw new Error('File not found');
      const type = resolved.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
      return send(res, 200, type, readFileSync(resolved));
    } catch {
      return send(res, 404, 'text/plain', 'File not found');
    }
  }
  if (req.method === 'POST' && req.url === '/api/run') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const input = JSON.parse(body || '{}');
        startRun(input.portal || 'all');
        send(res, 200, 'application/json', JSON.stringify({ ok: true, runId: activeRunId }));
      } catch (err) {
        send(res, 400, 'application/json', JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/application-status') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const input = JSON.parse(body || '{}');
        const statuses = dashboardStatuses();
        statuses[input.key] = { applied: Boolean(input.applied), updatedAt: new Date().toISOString() };
        writeJson(DASHBOARD_STATUS_PATH, statuses);
        send(res, 200, 'application/json', JSON.stringify({ ok: true }));
      } catch (err) {
        send(res, 400, 'application/json', JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/setup') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 15_000_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const input = JSON.parse(body || '{}');
        const cvText = await extractResumeText(input);
        ensureBasics(input, cvText);
        writeProfile(input);
        writeJobAlerts(input);
        writeEnv({
          GEMINI_API_KEY: input.geminiApiKey,
          LINKEDIN_STORAGE_STATE: input.linkedinStorageState,
          SLACK_WEBHOOK_URL: input.slackWebhookUrl,
          SLACK_BOT_TOKEN: input.slackBotToken,
          SLACK_CHANNEL_ID: input.slackChannelId,
          TELEGRAM_BOT_TOKEN: input.telegramBotToken,
          TELEGRAM_CHAT_ID: input.telegramChatId,
        });
        send(res, 200, 'application/json', JSON.stringify({ ok: true, status: status() }));
      } catch (err) {
        send(res, 500, 'application/json', JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url?.startsWith('/api/login/')) {
    try {
      const portal = req.url.split('/').pop();
      startPortalLogin(portal);
      return send(res, 200, 'application/json', JSON.stringify({ ok: true }));
    } catch (err) {
      return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: err.message }));
    }
  }
  send(res, 404, 'text/plain', 'Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Career-Engine setup wizard running at http://127.0.0.1:${PORT}`);
  console.log('Press Ctrl+C when you are done.');
});
