#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const patterns = [
  { name: 'Slack webhook', regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g },
  { name: 'Slack bot token', regex: /xox[baprs]-[A-Za-z0-9-]+/g },
  { name: 'Telegram bot token', regex: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'GitHub token', regex: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g },
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Local home path', regex: /\/Users\/[^/\s)]+\/[^\s)`"']+/g },
  { name: 'Slack channel ID literal', regex: /\bC(?=[0-9A-Z]{10,}\b)(?=[0-9A-Z]*\d)[0-9A-Z]{10,}\b/g },
];

const allowedFiles = new Set([
  '.env.example',
  'security-check.mjs',
]);

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => !allowedFiles.has(file));
}

function isPlaceholder(match) {
  return /example|your-|placeholder|\.\.\.|C0123456789|DAxxxxxxxxx/i.test(match);
}

const findings = [];
for (const file of trackedFiles()) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      if (isPlaceholder(match[0])) continue;
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      findings.push({ file, line, type: pattern.name, sample: match[0].slice(0, 12) + '...' });
    }
  }
}

if (findings.length) {
  console.error('Potential sensitive data found in tracked files:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.type} (${finding.sample})`);
  }
  process.exit(1);
}

console.log('No obvious secrets found in tracked files.');
