#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

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

async function postForm(url, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body,
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

async function postSlackApi(method, body, env, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return postSlackApiRequest(method, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }, env, timeoutMs);
}

async function postSlackFormApi(method, body, env, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return postSlackApiRequest(method, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])),
  }, env, timeoutMs);
}

async function postSlackApiRequest(method, request, env, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
        ...request.headers,
      },
      body: request.body,
      signal: controller.signal,
    });
    const json = await res.json();
    if (!json.ok) {
      const detail = json.response_metadata?.messages?.join('; ');
      throw new Error(`Slack ${method}: ${json.error || 'failed'}${detail ? ` (${detail})` : ''}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendSlack(message, env = process.env) {
  if (env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID) {
    try {
      const response = await postSlackApi('chat.postMessage', {
        channel: env.SLACK_CHANNEL_ID,
        text: message,
      }, env);
      return { channel: 'slack', sent: true, response: response.ok };
    } catch (err) {
      return { channel: 'slack', sent: false, error: err.message };
    }
  }

  if (!env.SLACK_WEBHOOK_URL) {
    return { channel: 'slack', skipped: true, reason: 'SLACK_BOT_TOKEN/SLACK_CHANNEL_ID or SLACK_WEBHOOK_URL missing' };
  }

  try {
    const response = await postJson(env.SLACK_WEBHOOK_URL, { text: message });
    return { channel: 'slack', sent: true, response };
  } catch (err) {
    return { channel: 'slack', sent: false, error: err.message };
  }
}

export async function sendSlackDocument(filePath, caption, env = process.env) {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) {
    return { channel: 'slack-file', skipped: true, reason: 'SLACK_BOT_TOKEN or SLACK_CHANNEL_ID missing' };
  }
  try {
    const absolutePath = path.resolve(filePath);
    const data = fs.readFileSync(absolutePath);
    const filename = path.basename(absolutePath);
    const upload = await postSlackFormApi('files.getUploadURLExternal', {
      filename,
      length: data.byteLength,
    }, env);

    const form = new FormData();
    form.append('file', new Blob([data], { type: 'application/pdf' }), filename);
    await postForm(upload.upload_url, form, 30_000);

    const completed = await postSlackFormApi('files.completeUploadExternal', {
      channel_id: env.SLACK_CHANNEL_ID,
      initial_comment: caption,
      files: JSON.stringify([{ id: upload.file_id, title: filename }]),
    }, env);
    return { channel: 'slack-file', sent: true, file_id: upload.file_id, response: completed.ok };
  } catch (err) {
    return { channel: 'slack-file', sent: false, error: err.message };
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

export async function sendTelegramDocument(filePath, caption, env = process.env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { channel: 'telegram-file', skipped: true, reason: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing' };
  }
  try {
    const absolutePath = path.resolve(filePath);
    const data = fs.readFileSync(absolutePath);
    const filename = path.basename(absolutePath);
    const form = new FormData();
    form.append('chat_id', env.TELEGRAM_CHAT_ID);
    form.append('caption', caption.replace(/\*/g, '').slice(0, 1024));
    form.append('document', new Blob([data], { type: 'application/pdf' }), filename);
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
    await postForm(url, form, 30_000);
    return { channel: 'telegram-file', sent: true };
  } catch (err) {
    return { channel: 'telegram-file', sent: false, error: err.message };
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
    if (job.resume?.pdfPath) {
      const caption = `Resume for ${job.company || 'Unknown company'} - ${job.title || 'Untitled role'}`;
      results.push(await sendSlackDocument(job.resume.pdfPath, caption, env));
      results.push(await sendTelegramDocument(job.resume.pdfPath, caption, env));
    }
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
