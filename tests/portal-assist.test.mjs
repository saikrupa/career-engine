#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  classifyLocation,
  filterRankAndDedupe,
  fitLabel,
  isLikelyUsJob,
  isRemoteJob,
  normalizeUrl,
  parseJobsFromFixtureHtml,
  scoreJob,
} from '../portal-assist.mjs';
import { notifyJobs } from '../notify-alerts.mjs';

const linkedInFixture = `
  <ul>
    <li class="jobs-search-results__list-item" data-job-id="123">
      <a href="https://www.linkedin.com/jobs/view/123/?trackingId=abc" class="job-card-container__link">Senior Android Engineer, AI Agents</a>
      <div class="job-card-container__primary-description">Acme AI</div>
      <div class="job-card-container__metadata-item">Dallas, TX (Remote)</div>
      <time>2 hours ago</time>
      <span>Easy Apply</span>
    </li>
  </ul>
`;

const indeedFixture = `
  <div data-jk="abc123" class="job_seen_beacon">
    <h2><a href="/viewjob?jk=abc123" data-jk="abc123"><span data-testid="jobTitle">Kotlin Mobile Platform Engineer</span></a></h2>
    <span data-testid="company-name">Fintech Co</span>
    <div data-testid="text-location">United States</div>
  </div>
`;

assert.equal(
  normalizeUrl('https://www.linkedin.com/jobs/view/123/?trackingId=abc&refId=zzz'),
  'https://www.linkedin.com/jobs/view/123/'
);
assert.equal(
  normalizeUrl('https://www.indeed.com/viewjob?jk=abc123&from=serp'),
  'https://www.indeed.com/viewjob?jk=abc123'
);

assert.equal(isLikelyUsJob({ title: 'Android Engineer', location: 'Dallas, TX', snippet: '' }), true);
assert.equal(isLikelyUsJob({ title: 'Android Engineer', location: 'Toronto, Canada', snippet: '' }), false);
assert.equal(classifyLocation({ title: 'Android Engineer', location: 'Remote - United States', snippet: '' }).priority, 'REMOTE - jump on this');
assert.equal(classifyLocation({ title: 'Android Engineer', location: 'Dallas, TX', snippet: '' }).priority, 'A1 Dallas/DFW');
assert.equal(classifyLocation({ title: 'Android Engineer', location: 'New York, NY', snippet: '' }).accepted, false);
assert.equal(isRemoteJob({ title: 'Android Engineer', location: 'Remote - United States', snippet: '' }), true);

const highScore = scoreJob({
  title: 'Senior Android Kotlin AI Agents Engineer',
  company: 'Acme',
  location: 'Dallas, TX Remote',
  snippet: 'SDK developer experience automation',
});
assert.ok(highScore >= 85);
assert.equal(fitLabel(highScore), 'Strong match');

const deduped = filterRankAndDedupe(
  [
    { title: 'Senior Android Engineer', company: 'Acme', location: 'Dallas, TX', url: 'https://example.com/1', snippet: '' },
    { title: 'Senior Android Engineer', company: 'Acme', location: 'Dallas, TX', url: 'https://example.com/2', snippet: '' },
    { title: 'iOS Engineer', company: 'Maple', location: 'Toronto, Canada', url: 'https://example.com/3', snippet: '' },
    { title: 'Senior Android Engineer', company: 'NY Co', location: 'New York, NY', url: 'https://example.com/4', snippet: '' },
  ],
  'test',
  { urls: new Set(), companyRoles: new Set() }
);
assert.equal(deduped.length, 1);

const linkedIn = parseJobsFromFixtureHtml('linkedin', linkedInFixture, 'https://www.linkedin.com');
assert.equal(linkedIn.length, 1);
assert.equal(linkedIn[0].company, 'Acme AI');
assert.equal(linkedIn[0].title, 'Senior Android Engineer, AI Agents');
assert.equal(linkedIn[0].postedText, '2 hours ago');
assert.equal(linkedIn[0].easyApply, true);

const indeed = parseJobsFromFixtureHtml('indeed', indeedFixture, 'https://www.indeed.com');
assert.equal(indeed.length, 1);
assert.equal(indeed[0].company, 'Fintech Co');
assert.equal(indeed[0].title, 'Kotlin Mobile Platform Engineer');

const notification = await notifyJobs([
  { company: 'Acme', title: 'Senior Android Engineer', location: 'Remote - United States', url: 'https://example.com', score: 91 },
], { dryRun: true });
assert.equal(notification.length, 1);
assert.match(notification[0].message, /Acme - Senior Android Engineer/);
assert.match(notification[0].message, /REMOTE PRIORITY/);

console.log('portal-assist tests passed');
