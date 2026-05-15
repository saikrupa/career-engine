#!/usr/bin/env node

import 'dotenv/config';

const DEFAULT_TIMEOUT_MS = 10_000;

function isRemote(job) {
  return /remote|work from home|work anywhere|anywhere in (the )?(us|united states)/i.test(`${job.location || ''} ${job.locationPriority || ''} ${job.snippet || ''}`);
}

function isAndroidJob(job) {
  return /android|kotlin|jetpack|compose|kmp|mobile engineer|mobile platform|sdk/i.test(`${job.title || ''} ${job.snippet || ''}`);
}

export function formatJobAlert(job) {
  const remote = isRemote(job);
  const fit = remote ? 'REMOTE PRIORITY - APPLY ASAP' : (job.locationPriority || job.fitLabel || job.fit || 'New match');
  const location = job.location ? ` | ${job.location}` : '';
  const source = job.source ? ` | ${job.source}` : '';
  const hasScore = typeof job.score === 'number';
  const scoreLine = hasScore ? `\nMatch score: ${job.score}%` : '\nMatch score: N/A';
  const posted = job.postedText ? `\nPosted: ${job.postedText}` : '';
  const easyApply = typeof job.easyApply === 'boolean' ? `\nEasy Apply: ${job.easyApply ? 'Yes' : 'No'}` : '';
  const highPriorityRemoteAndroid = remote && isAndroidJob(job) && hasScore && job.score >= 60;
  const marker = highPriorityRemoteAndroid ? '🚨🚨🚨 [REMOTE]' : (remote ? '[REMOTE]' : '[MATCH]');
  return `${marker} *${fit}*\n${job.company || 'Unknown company'} - ${job.title || 'Untitled role'}${location}${source}${scoreLine}${posted}${easyApply}\n${job.url}`;
}

async function postJson(url, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendSlack(message, env = process.env) {
  if (!env.SLACK_WEBHOOK_URL) {
    return { channel: 'slack', skipped: true, reason: 'SLACK_WEBHOOK_URL missing' };
  }
  try {
    const response = await postJson(env.SLACK_WEBHOOK_URL, { text: message });
    return { channel: 'slack', sent: true, response };
  } catch (err) {
    return { channel: 'slack', sent: false, error: err.message };
  }
}

export async function sendTelegram(message, env = process.env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { channel: 'telegram', skipped: true, reason: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing' };
  }
  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await postJson(url, {
      chat_id: env.TELEGRAM_CHAT_ID,
      text: message.replace(/\*/g, ''),
      disable_web_page_preview: false,
    });
    return { channel: 'telegram', sent: true };
  } catch (err) {
    return { channel: 'telegram', sent: false, error: err.message };
  }
}

export async function notifyJobs(jobs, options = {}) {
  const env = options.env || process.env;
  const dryRun = Boolean(options.dryRun);
  const results = [];

  for (const job of jobs) {
    const message = formatJobAlert(job);
    if (dryRun) {
      results.push({ channel: 'dry-run', message });
      continue;
    }
    results.push(await sendSlack(message, env));
    results.push(await sendTelegram(message, env));
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const testJob = {
    company: 'Career Engine Test',
    title: 'Senior Android / AI Agents Engineer',
    location: 'Remote - United States',
    source: 'notification-test',
    url: 'https://example.com/job',
    score: 95,
    fitLabel: 'REMOTE PRIORITY',
    locationPriority: 'REMOTE - jump on this',
  };
  testJob.postedText = new Date().toISOString();

  const results = await notifyJobs([testJob], { dryRun });
  console.log(JSON.stringify(results, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Notification failed: ${err.message}`);
    process.exit(1);
  });
}
