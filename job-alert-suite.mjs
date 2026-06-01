#!/usr/bin/env node

import 'dotenv/config';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import yaml from 'js-yaml';
import { appendToPipeline, appendToScanHistory, runCapture, sleep } from './portal-assist.mjs';
import { notifyJobs } from './notify-alerts.mjs';
import { generateTailoredResumesForJobs } from './generate-tailored-resumes.mjs';

const CONFIG_PATH = 'config/job-alerts.yml';
const PROFILE_PATH = 'config/profile.yml';
const SUPPORTED_PORTALS = ['linkedin', 'indeed', 'dice', 'naukri'];
const PORTAL_LOGIN_PROFILE_ROOT = '.browser-profiles';

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

async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) throw new Error(`${CONFIG_PATH} not found`);
  const config = yaml.load(await readFile(CONFIG_PATH, 'utf8'));
  if (!Array.isArray(config.keywords) || config.keywords.length === 0) {
    config.keywords = await loadKeywordFallbacks();
    console.warn(`Preflight: config/job-alerts.yml has no keywords; using ${config.keywords.length} role keyword(s) from profile/defaults.`);
  }
  return config;
}

async function loadKeywordFallbacks() {
  if (existsSync(PROFILE_PATH)) {
    const profile = yaml.load(await readFile(PROFILE_PATH, 'utf8')) || {};
    const primary = profile.target_roles?.primary || [];
    const archetypes = (profile.target_roles?.archetypes || []).map((item) => item?.name).filter(Boolean);
    const keywords = [...primary, ...archetypes]
      .map((item) => String(item).trim())
      .filter(Boolean);
    if (keywords.length > 0) return [...new Set(keywords)].slice(0, 8);
  }
  return [
    'Senior Android Engineer Kotlin',
    'Android Developer Kotlin',
    'Android Engineer Jetpack Compose',
    'Mobile Android Engineer',
    'Android SDK Engineer',
    'Android Platform Engineer',
    'Kotlin Multiplatform Android',
    'Lead Android Developer',
    'Android Architect',
    'Android Architecture Engineer',
  ];
}

function searchRadiusForLocation(location, config) {
  const text = String(location || '').toLowerCase();
  const radiusConfig = config.search_radius || {};
  if (/remote/.test(text)) return null;
  if (/dallas|dfw|plano|irving|frisco|fort worth|arlington|richardson|addison/.test(text)) {
    return radiusConfig.dallas_miles ?? 80;
  }
  if (/texas|\btx\b/.test(text)) return radiusConfig.texas_miles ?? null;
  return radiusConfig.default_miles ?? null;
}

function listFromCsvOrArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function linkedinSearchUrl(keyword, location, config) {
  const params = new URLSearchParams({
    keywords: keyword,
    location,
    f_TPR: 'r86400',
  });
  if (/remote/i.test(location)) params.set('f_WT', '2');
  const radius = searchRadiusForLocation(location, config);
  if (radius) params.set('distance', String(radius));
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function indeedSearchUrl(keyword, location, config) {
  const params = new URLSearchParams({
    q: keyword,
    l: location,
    fromage: '1',
  });
  if (/remote/i.test(location)) params.set('remotejob', '1');
  const radius = searchRadiusForLocation(location, config);
  if (radius) params.set('radius', String(radius));
  return `https://www.indeed.com/jobs?${params.toString()}`;
}

function diceSearchUrl(keyword, location, config) {
  const params = new URLSearchParams({
    q: keyword,
    location,
  });
  if (/remote/i.test(location)) {
    params.set('filters.workplaceTypes', 'Remote');
  }
  const radius = searchRadiusForLocation(location, config);
  if (radius) params.set('radius', String(radius));
  return `https://www.dice.com/jobs?${params.toString()}`;
}

function naukriSearchUrl(keyword, location) {
  const slug = String(keyword || 'software engineer')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'software-engineer';
  const params = new URLSearchParams();
  if (location) params.set('k', keyword);
  if (location) params.set('l', location);
  return `https://www.naukri.com/${slug}-jobs?${params.toString()}`;
}

function resolveCountries(config, countryFilter = null) {
  if (countryFilter && countryFilter.length > 0) return countryFilter;
  if (Array.isArray(config.active_countries) && config.active_countries.length > 0) {
    return config.active_countries.map((value) => String(value).toLowerCase()).filter(Boolean);
  }
  return [];
}

function resolveLocations(config, countries = []) {
  const countryLocations = config.country_locations || {};
  if (countries.length > 0 && typeof countryLocations === 'object' && Object.keys(countryLocations).length > 0) {
    const merged = [];
    for (const country of countries) {
      const values = countryLocations[country];
      if (!Array.isArray(values)) continue;
      merged.push(...values.map((item) => String(item).trim()).filter(Boolean));
    }
    if (merged.length > 0) return [...new Set(merged)];
  }
  return [
    ...(config.locations?.remote || []),
    ...(config.locations?.local || []),
    ...(config.locations?.texas || []),
  ];
}

function resolveEnabledPortals(config, countries = [], portalFilter = null) {
  const filteredPortals = portalFilter && portalFilter.length > 0 ? new Set(portalFilter) : null;
  const countryPortals = config.country_portals || {};
  let countryAllowed = null;

  if (countries.length > 0 && typeof countryPortals === 'object' && Object.keys(countryPortals).length > 0) {
    countryAllowed = new Set();
    for (const country of countries) {
      const portals = countryPortals[country] || [];
      for (const portal of portals) {
        countryAllowed.add(String(portal).toLowerCase());
      }
    }
  }

  const requested = Object.entries(config.portals || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([portal]) => String(portal).toLowerCase());
  const enabled = requested.filter((portal) => {
    if (filteredPortals && !filteredPortals.has(portal)) return false;
    if (countryAllowed && !countryAllowed.has(portal)) return false;
    return true;
  });

  return [...new Set(enabled)];
}

function hasPortalLoginConfig(portal, config) {
  const profileExists = existsSync(`${PORTAL_LOGIN_PROFILE_ROOT}/${portal}`);
  if (portal === 'linkedin') {
    const storageState = process.env.LINKEDIN_STORAGE_STATE || config.session?.linkedin_storage_state;
    return Boolean(storageState) || profileExists;
  }
  return profileExists;
}

function hasAnyNotificationConfig() {
  const hasSlackBot = Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID);
  const hasSlackWebhook = Boolean(process.env.SLACK_WEBHOOK_URL);
  const hasTelegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  return hasSlackBot || hasSlackWebhook || hasTelegram;
}

function applyPreflightValidation(config, portals) {
  const validation = config.validation || {};
  const skipUnconfigured = validation.skip_unconfigured_portals !== false;
  const requirePortalLogin = validation.require_portal_login !== false;
  const validated = [];
  const skipped = [];

  for (const portal of portals) {
    if (!SUPPORTED_PORTALS.includes(portal)) {
      skipped.push({ portal, reason: 'unsupported portal in job-alert-suite (supported: linkedin, indeed, dice, naukri)' });
      continue;
    }
    if (requirePortalLogin && !hasPortalLoginConfig(portal, config)) {
      skipped.push({ portal, reason: `missing login profile for ${portal}; run npm run portal:login -- ${portal}` });
      continue;
    }
    validated.push(portal);
  }

  if (config.actions?.notify && !hasAnyNotificationConfig()) {
    config.actions.notify = false;
    console.warn('Preflight: notifications disabled because Slack/Telegram credentials are not configured.');
  }

  if (!skipUnconfigured && skipped.length > 0) {
    const detail = skipped.map((item) => `${item.portal}: ${item.reason}`).join('; ');
    throw new Error(`Preflight validation failed: ${detail}`);
  }

  return { validated, skipped };
}

function buildSearches(config, options = {}) {
  const searches = [];
  const countries = resolveCountries(config, options.countryFilter || []);
  const enabledPortals = resolveEnabledPortals(config, countries, options.portalFilter || []);
  const locations = resolveLocations(config, countries);

  for (const keyword of config.keywords || []) {
    for (const location of locations) {
      if (enabledPortals.includes('linkedin')) {
        searches.push({ portal: 'linkedin', keyword, location, url: linkedinSearchUrl(keyword, location, config) });
      }
      if (enabledPortals.includes('indeed')) {
        searches.push({ portal: 'indeed', keyword, location, url: indeedSearchUrl(keyword, location, config) });
      }
      if (enabledPortals.includes('dice')) {
        searches.push({ portal: 'dice', keyword, location, url: diceSearchUrl(keyword, location, config) });
      }
      if (enabledPortals.includes('naukri')) {
        searches.push({ portal: 'naukri', keyword, location, url: naukriSearchUrl(keyword, location) });
      }
    }
  }

  return { searches, portals: enabledPortals, countries };
}

function shouldKeepByScore(job, config) {
  const minScore = Number(config.thresholds?.default_min_score ?? 50);
  const text = `${job.title} ${job.snippet || ''}`;
  const title = String(job.title || '');
  const mobileStack = /android|jetpack|compose|kmp|flutter|react[- ]native/i;
  const androidRelated = /android|jetpack|compose|kmp/i.test(text) || (/kotlin/i.test(text) && /android|mobile/i.test(text));
  const androidTitle = /android|jetpack|compose|kmp/i.test(title) || (/kotlin/i.test(title) && /android|mobile/i.test(text));
  const mobileStackRelated = mobileStack.test(text) || (/kotlin/i.test(text) && /mobile/i.test(text));
  const mobileStackTitle = mobileStack.test(title) || (/kotlin/i.test(title) && /mobile/i.test(title));
  const targetTitle = /android|kotlin|jetpack|compose|kmp|flutter|react[- ]native|mobile|application developer|app developer|sdk|ai infrastructure|ai tooling/i.test(title);
  const clearlyWrongTitle = /ios|swift|objective-c|roblox|rails|elixir|erlang|\.net|java|designer|product manager|fitness trainer|mechanic|diesel|sales|account executive|test automation|sdet|qa|ux|ui engineer/i.test(title) && !/android|kotlin|kmp|flutter|react[- ]native/i.test(title);

  if (job.source === 'dice') {
    if (!mobileStackRelated || !mobileStackTitle) return false;
  } else if (!androidRelated) {
    return false;
  }

  if (job.source === 'dice' && !androidTitle && !mobileStackTitle) return false;
  if (/intern|new grad/i.test(title)) return false;
  if (clearlyWrongTitle) return false;
  if (!targetTitle) return false;
  if (config.thresholds?.alert_all_android && androidRelated) {
    return true;
  }
  return Number(job.score || 0) >= minScore;
}

function dedupeJobs(jobs) {
  const seen = new Set();
  const deduped = [];
  for (const job of jobs) {
    const key = job.url || `${job.company}::${job.title}::${job.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(job);
  }
  return deduped.sort((a, b) => (a.locationRank ?? 99) - (b.locationRank ?? 99) || (b.score || 0) - (a.score || 0));
}

async function attachTailoredResumesIfNeeded(config, jobs) {
  if (!config.actions?.generate_tailored_resumes || jobs.length === 0) return null;
  return generateTailoredResumesForJobs(jobs);
}

async function writeRunSummary(summary) {
  await mkdir('output', { recursive: true });
  await writeFile('output/last-alert-run.json', JSON.stringify({
    ...summary,
    updatedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
}

function applyNotificationRouting(config, jobs) {
  const slackChannelByPortal = config.notifications?.slack_channel_by_portal || {};
  for (const job of jobs) {
    const channel = slackChannelByPortal[job.source];
    if (channel) job.slackChannelId = channel;
  }
}

function captureOptionsForPortal(config, portal) {
  const defaults = {
    pages: config.capture?.pages || 1,
    scrolls: config.capture?.scrolls || 4,
    detail_limit: config.capture?.detail_limit || 25,
    action_delay_ms: config.capture?.action_delay_ms || 1600,
    search_delay_ms: config.capture?.search_delay_ms || 3000,
    slow_mo: config.capture?.slow_mo || 0,
    headless: config.capture?.headless ?? true,
  };
  const overrides = config.capture?.portal_overrides?.[portal] || {};
  return { ...defaults, ...overrides };
}

async function runOnce(options = {}) {
  const config = await loadConfig();
  const portalFilter = listFromCsvOrArray(options.portal).map((item) => item.toLowerCase());
  const countryFilter = listFromCsvOrArray(options.country).map((item) => item.toLowerCase());
  if (portalFilter.some((portal) => !SUPPORTED_PORTALS.includes(portal))) {
    throw new Error('--portal must be a comma-separated list containing linkedin, indeed, dice, or naukri');
  }
  const { searches: generatedSearches, portals, countries } = buildSearches(config, { portalFilter, countryFilter });
  const preflight = applyPreflightValidation(config, portals);
  const usablePortals = new Set(preflight.validated);
  let searches = generatedSearches.filter((search) => usablePortals.has(search.portal));

  if (preflight.skipped.length > 0) {
    console.log('Preflight skipped portals:');
    for (const item of preflight.skipped) {
      console.log(`- ${item.portal}: ${item.reason}`);
    }
  }
  if (searches.length === 0) {
    throw new Error('No runnable searches after applying country/portal filters and preflight validation.');
  }

  if (options['limit-searches']) {
    searches = searches.slice(0, Number(options['limit-searches']));
  }
  const dryRun = Boolean(options['dry-run']);
  const betweenSearchDelayMs = Math.max(
    Number(options['between-search-delay-ms'] || config.capture?.between_search_delay_ms || 3500),
    0
  );
  let totalNew = 0;

  const portalSummary = preflight.validated.join(', ');
  const countrySummary = countries.length > 0 ? countries.join(', ') : 'default locations';
  console.log(`Job alert suite: ${searches.length} generated Android searches | portals: ${portalSummary} | countries: ${countrySummary}`);
  if (dryRun) console.log('(dry run - no pipeline writes, alerts, or PDFs)');
  const collected = [];
  const failures = [];

  for (let i = 0; i < searches.length; i += 1) {
    const search = searches[i];
    console.log(`\nSearch ${i + 1}/${searches.length}: ${search.portal} | ${search.keyword} | ${search.location}`);
    const storageState = search.portal === 'linkedin'
      ? (process.env.LINKEDIN_STORAGE_STATE || config.session?.linkedin_storage_state)
      : undefined;
    const captureOptions = captureOptionsForPortal(config, search.portal);
    try {
      const jobs = await runCapture(search.portal, {
        url: search.url,
        pages: captureOptions.pages,
        scrolls: captureOptions.scrolls,
        'detail-limit': captureOptions.detail_limit,
        'action-delay-ms': captureOptions.action_delay_ms,
        'search-delay-ms': captureOptions.search_delay_ms,
        'slow-mo': captureOptions.slow_mo,
        headless: captureOptions.headless,
        'storage-state': storageState,
        'collect-only': true,
        'dry-run': false,
        'no-notify': true,
      });

      const kept = jobs.filter((job) => shouldKeepByScore(job, config));
      collected.push(...kept);
      if (kept.length !== jobs.length) {
        console.log(`Score filter: kept ${kept.length}/${jobs.length} from ${search.portal} | ${search.keyword} | ${search.location}`);
      }
    } catch (err) {
      const message = err?.message || String(err);
      failures.push({ search, error: message });
      console.warn(`Search skipped after error: ${message}`);
    }
    if (i < searches.length - 1 && betweenSearchDelayMs > 0) {
      await sleep(betweenSearchDelayMs);
    }
  }

  const finalJobs = dedupeJobs(collected);
  applyNotificationRouting(config, finalJobs);
  totalNew = finalJobs.length;
  let resumeResult = null;
  let notificationResult = [];

  if (!dryRun) {
    resumeResult = await attachTailoredResumesIfNeeded(config, finalJobs);
    if (resumeResult) {
      console.log(`Generated ${resumeResult.manifest.length} tailored resume PDF(s) for alerts.`);
    }
  }

  if (!dryRun && finalJobs.length > 0) {
    let historyWritten = false;
    if (config.actions?.add_to_pipeline) {
      appendToPipeline(finalJobs);
      appendToScanHistory(finalJobs);
      historyWritten = true;
    }
    if (config.actions?.notify) {
      notificationResult = await notifyJobs(finalJobs);
      console.log(JSON.stringify(notificationResult, null, 2));
      if (!historyWritten) {
        appendToScanHistory(finalJobs);
      }
    }
  }

  if (failures.length > 0) {
    console.log(`\nSkipped searches due to errors: ${failures.length}`);
    for (const failure of failures) {
      console.log(`- ${failure.search.portal} | ${failure.search.keyword} | ${failure.search.location}: ${failure.error.split('\n')[0]}`);
    }
  }
  await writeRunSummary({
    dryRun,
    countries,
    portals: preflight.validated,
    skipped: preflight.skipped,
    failures,
    totalNew,
    jobs: finalJobs,
    resumes: resumeResult?.manifest || [],
    manifestPath: resumeResult?.manifestPath || '',
    notifications: notificationResult,
  });
  console.log(`Job alert suite complete. New actionable jobs: ${totalNew}`);
}

async function runLoop(options = {}) {
  const config = await loadConfig();
  const intervalMs = Number(config.interval_minutes || 30) * 60 * 1000;
  console.log(`Job alert suite running every ${config.interval_minutes || 30} minutes.`);
  while (true) {
    await runOnce(options).catch((err) => {
      console.error(`Suite run failed: ${err.message}`);
    });
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'once';
  if (command === 'once') return runOnce(args);
  if (command === 'run') return runLoop(args);
  console.log('Usage: node job-alert-suite.mjs once|run [--dry-run] [--portal linkedin,indeed,dice,naukri] [--country us,india]');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`job-alert-suite failed: ${err.message}`);
    process.exit(1);
  });
}
