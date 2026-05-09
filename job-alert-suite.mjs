#!/usr/bin/env node

import 'dotenv/config';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { spawn } from 'child_process';
import yaml from 'js-yaml';
import { appendToPipeline, appendToScanHistory, runCapture } from './portal-assist.mjs';
import { notifyJobs } from './notify-alerts.mjs';

const CONFIG_PATH = 'config/job-alerts.yml';

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
  return yaml.load(await readFile(CONFIG_PATH, 'utf8'));
}

function linkedinSearchUrl(keyword, location) {
  const params = new URLSearchParams({
    keywords: keyword,
    location,
    f_TPR: 'r86400',
  });
  if (/remote/i.test(location)) params.set('f_WT', '2');
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function indeedSearchUrl(keyword, location) {
  const params = new URLSearchParams({
    q: keyword,
    l: location,
    fromage: '1',
  });
  if (/remote/i.test(location)) params.set('remotejob', '1');
  return `https://www.indeed.com/jobs?${params.toString()}`;
}

function buildSearches(config) {
  const searches = [];
  const locations = [
    ...(config.locations?.remote || []),
    ...(config.locations?.local || []),
    ...(config.locations?.texas || []),
  ];

  for (const keyword of config.keywords || []) {
    for (const location of locations) {
      if (config.portals?.linkedin) {
        searches.push({ portal: 'linkedin', keyword, location, url: linkedinSearchUrl(keyword, location) });
      }
      if (config.portals?.indeed) {
        searches.push({ portal: 'indeed', keyword, location, url: indeedSearchUrl(keyword, location) });
      }
    }
  }

  return searches;
}

function shouldKeepByScore(job, config) {
  const minScore = Number(config.thresholds?.default_min_score ?? 50);
  const text = `${job.title} ${job.snippet || ''}`;
  const title = String(job.title || '');
  const androidRelated = /android|kotlin|jetpack|compose|kmp|mobile platform|mobile engineer/i.test(text);
  const clearlyNonAndroidMobile = /ios|swift|objective-c|flutter|react native/i.test(title) && !/android|kotlin|kmp/i.test(title);

  if (clearlyNonAndroidMobile) return false;
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

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function generateTailoredResumesIfNeeded(config, newJobsCount) {
  if (!config.actions?.generate_tailored_resumes || newJobsCount === 0) return;
  await runCommand('node', ['generate-tailored-resumes.mjs']);
}

async function runOnce(options = {}) {
  const config = await loadConfig();
  let searches = buildSearches(config);
  if (options['limit-searches']) {
    searches = searches.slice(0, Number(options['limit-searches']));
  }
  const dryRun = Boolean(options['dry-run']);
  let totalNew = 0;

  console.log(`Job alert suite: ${searches.length} generated Android searches`);
  if (dryRun) console.log('(dry run - no pipeline writes, alerts, or PDFs)');
  const collected = [];

  for (const search of searches) {
    const storageState = search.portal === 'linkedin' ? config.session?.linkedin_storage_state : undefined;
    const jobs = await runCapture(search.portal, {
      url: search.url,
      pages: config.capture?.pages || 1,
      scrolls: config.capture?.scrolls || 4,
      'detail-limit': config.capture?.detail_limit || 25,
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
  }

  const finalJobs = dedupeJobs(collected);
  totalNew = finalJobs.length;

  if (!dryRun && finalJobs.length > 0) {
    if (config.actions?.add_to_pipeline) {
      appendToPipeline(finalJobs);
      appendToScanHistory(finalJobs);
    }
    if (config.actions?.notify) {
      const notificationResult = await notifyJobs(finalJobs);
      console.log(JSON.stringify(notificationResult, null, 2));
    }
  }

  if (!dryRun) await generateTailoredResumesIfNeeded(config, totalNew);
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
  console.log('Usage: node job-alert-suite.mjs once|run [--dry-run]');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`job-alert-suite failed: ${err.message}`);
    process.exit(1);
  });
}
