#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { chromium } from 'playwright';

const root = process.cwd();
const today = new Date().toISOString().slice(0, 10);

const profile = yaml.load(fs.readFileSync(path.join(root, 'config/profile.yml'), 'utf8'));
const template = fs.readFileSync(path.join(root, 'templates/cv-template.html'), 'utf8');

const baseExperience = [
  {
    company: 'CVS Pharmacy',
    period: '2026-Present',
    role: 'Senior Software / Lead Engineer, Android Foundation Team',
    location: 'Dallas, TX / Remote',
    bullets: [
      'Contribute to the Foundation team owning core Android libraries, shared modules, and CI/CD pipelines for the flagship CVS Health mobile application.',
      'Support modularization from a monolithic Android app toward the scalable Health 100 platform for multi-pharmacy integrations.',
      'Contribute to Datadog migration for improved monitoring, logging, performance tracking, and production observability.',
      'Implement CI/CD quality gates, including 16KB memory compliance checks and hard gating rules to prevent non-compliant builds.',
      'Strengthen app security with ProGuard/R8 code obfuscation and remediation of vulnerabilities identified through Snyk and Data Theorem.',
      'Upgrade and standardize code quality tooling with Ktlint and Spotless across Android teams.'
    ],
  },
  {
    company: 'Capital One',
    period: '2024-2026',
    role: 'Senior Software / Lead Engineer, Android',
    location: 'Plano, TX / Remote',
    bullets: [
      'Built Small Business Banking features for Transactions, Check Deposits, and Business Information management using Kotlin and Jetpack Compose.',
      'Implemented state-driven UI with reactive ViewModels and unidirectional data flow using State, Actions, and Reducers.',
      'Integrated GraphQL and REST APIs for real-time and on-demand financial data.',
      'Applied Kotlin Coroutines and Flow for structured concurrency and reactive Compose data updates.',
      'Built multi-module Android architecture to improve scalability, build times, and separation of concerns.',
      'Created and maintained unit tests and Compose UI tests with JUnit and Compose testing APIs.'
    ],
  },
  {
    company: 'MoneyGram International',
    period: '2023-2025',
    role: 'Senior Software / Lead Engineer, Android',
    location: 'Plano, TX',
    bullets: [
      'Led Android development for MoneyGram US and International app redesigns using Jetpack Compose.',
      'Used Kotlin Flow, Data Binding, Hilt, MVVM, Room, WorkManager, LiveData, Navigation, Coroutines, and DataStore.',
      'Built REST and Lambda integrations, cached API data for offline usage, and parsed server responses.',
      'Integrated Apollo GraphQL, WebSockets, Firebase Crashlytics, Retrofit, Moshi, LaunchDarkly, Instana, SFMC, Imperva, and reCAPTCHA.',
      'Wrote unit and UI tests with JUnit, Mockito, Espresso, and Jetpack Compose Testing.',
      'Improved performance with Android Profiler and LeakCanary.'
    ],
  },
  {
    company: 'Passport, Inc.',
    period: '2022-2023',
    role: 'Senior Software Engineer, Android',
    location: 'Charlotte, NC / Remote',
    bullets: [
      'Built white-label mobile parking solutions for the US market and owned Android application delivery.',
      'Developed Kotlin Android features with Hilt, MVVM, Room, WorkManager, LiveData, DataStore, Retrofit, AWS, Firebase, Jenkins, Transifex, and Gradle.',
      'Implemented periodic background work, REST/Lambda request handling, offline data caching, and responsive layouts.',
      'Coordinated offshore mobile teams, testing teams, sprint demos, code reviews, and release delivery.'
    ],
  },
  {
    company: 'CharterGlobal, Inc.',
    period: '2017-2022',
    role: 'Team Lead, Mobile Engineering',
    location: 'Atlanta, GA',
    bullets: [
      'Led 12+ engineers across Android and iOS teams for multiple customer-facing web, mobile, healthcare, real estate, and TV applications.',
      'Owned requirements gathering, impact analysis, sprint planning, user stories, daily standups, blocker resolution, client demos, and release coordination.',
      'Refactored Android codebases to improve memory efficiency, reduce redundancy, and align with Android and Java standards.',
      'Maintained application health above 99% by analyzing Android vitals, startup performance, user reviews, and analytics.',
      'Rewrote Xamarin code to native Android and migrated traditional apps to single-activity architecture.'
    ],
  },
];

const skillMap = [
  ['Android', /android/i],
  ['Kotlin', /kotlin/i],
  ['Jetpack Compose', /compose|jetpack/i],
  ['Kotlin Multiplatform', /\bkmp\b|kotlin multiplatform/i],
  ['Mobile Platform', /mobile platform|foundation|shared module|platform/i],
  ['SDK Development', /\bsdk\b|developer tools/i],
  ['AI Agents', /agent|agentic/i],
  ['AI-Assisted Development', /ai sdk|claude|cursor|developer experience|developer tools|ai-assisted|ai assisted/i],
  ['Workflow Automation', /workflow|automation|orchestration/i],
  ['Coroutines and Flow', /coroutine|flow/i],
  ['MVVM / State Management', /mvvm|state|reducer|viewmodel/i],
  ['GraphQL / REST APIs', /graphql|rest|api/i],
  ['CI/CD and Build Quality', /ci\/cd|github actions|jenkins|gradle|build/i],
  ['Observability', /observability|monitoring|datadog|crashlytics|reliability/i],
  ['Security', /security|oauth|snyk|r8|proguard|owasp/i],
  ['Testing', /test|junit|espresso|mockito/i],
  ['Performance Optimization', /performance|memory|profiler|leak/i],
  ['Architecture', /architecture|architect|modular|multi-module/i],
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

function filenameSlug(value) {
  return slug(value).replace(/-/g, '_') || 'company';
}

function jobIdFromUrl(url, fallback) {
  try {
    const parsed = new URL(url);
    const linkedInId = parsed.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] || parsed.searchParams.get('currentJobId');
    if (linkedInId) return linkedInId;
    const indeedId = parsed.searchParams.get('jk') || parsed.searchParams.get('vjk');
    if (indeedId) return indeedId;
    const diceId = parsed.hostname.includes('dice.com')
      ? parsed.pathname.match(/\/job-detail\/([^/?#]+)$/)?.[1]
      : '';
    if (diceId) return filenameSlug(diceId);
    const pathId = parsed.pathname.match(/(\d{5,})/)?.[1];
    if (pathId) return pathId;
  } catch {
    // Fall back below.
  }
  return slug(fallback || 'job');
}

function pickKeywords(text, title) {
  const hay = `${title}\n${text}`;
  const found = [];
  for (const [label, rx] of skillMap) {
    if (rx.test(hay)) found.push(label);
  }
  const defaults = ['Android', 'Kotlin', 'Jetpack Compose', 'Mobile Platform', 'CI/CD and Build Quality', 'Observability'];
  return [...new Set([...found, ...defaults])].slice(0, 10);
}

function scoreBullet(bullet, keywords) {
  const b = bullet.toLowerCase();
  return keywords.reduce((sum, kw) => sum + (b.includes(kw.toLowerCase().split(' ')[0]) ? 1 : 0), 0);
}

function renderExperience(keywords) {
  return baseExperience.map((job) => {
    const bullets = [...job.bullets]
      .sort((a, b) => scoreBullet(b, keywords) - scoreBullet(a, keywords))
      .slice(0, job.company === 'CharterGlobal, Inc.' ? 4 : 5)
      .map((b) => `<li>${escapeHtml(b)}</li>`)
      .join('\n');
    return `
      <div class="job">
        <div class="job-header">
          <div class="job-company">${escapeHtml(job.company)}</div>
          <div class="job-period">${escapeHtml(job.period)}</div>
        </div>
        <div class="job-role">${escapeHtml(job.role)} <span class="job-location">${escapeHtml(job.location)}</span></div>
        <ul>${bullets}</ul>
      </div>`;
  }).join('\n');
}

function renderProjects(keywords) {
  const projects = [
    ['CVS Health Android Foundation', 'Shared modules, core libraries, CI/CD quality gates, modularization, Datadog migration, Snyk/Data Theorem remediation, Ktlint, Spotless, and ProGuard/R8.', 'Android, CI/CD, observability, security'],
    ['Capital One Small Business Banking', 'Kotlin and Jetpack Compose features for transactions, check deposits, business information management, GraphQL/REST, reactive state, and Compose tests.', 'Kotlin, Compose, GraphQL, testing'],
    ['MoneyGram Android Redesign', 'Jetpack Compose redesign with GraphQL, REST, WebSockets, fraud protection, monitoring, feature flags, multilingual support, and production crash diagnostics.', 'Compose, GraphQL, WebSockets, Crashlytics'],
    ['Passport Parking Apps', 'White-label parking applications using Kotlin, MVVM, Hilt, Room, WorkManager, AWS, Firebase, Jenkins, and Transifex.', 'Kotlin, MVVM, Hilt, WorkManager'],
  ];
  return projects.map(([name, desc, tech]) => `
    <div class="project">
      <div class="project-title">${escapeHtml(name)}</div>
      <div class="project-desc">${escapeHtml(desc)}</div>
      <div class="project-tech">${escapeHtml(tech)}</div>
    </div>`).join('\n');
}

function renderSkills(keywords) {
  const rows = [
    ['Targeted', keywords.join(', ')],
    ['Android', 'Kotlin, Java, Android SDK, Jetpack Compose, Material Design, Android TV, Wear OS'],
    ['Architecture', 'MVVM, Hilt, Dagger, Room, WorkManager, Navigation, Paging, multi-module architecture'],
    ['Async and APIs', 'Coroutines, Flow, RxJava, REST, GraphQL, Apollo Client, Retrofit, Moshi, WebSockets'],
    ['Quality', 'JUnit, Mockito, Espresso, Compose Testing, Ktlint, Spotless, Gradle, GitHub Actions, Jenkins'],
    ['Production', 'Crashlytics, Datadog, Instana, Android Profiler, LeakCanary, Snyk, Data Theorem, ProGuard/R8'],
    ['AI Tools', 'ChatGPT, Claude, Gemini, Cursor, Windsurf, Copilot, prompt engineering, context engineering'],
  ];
  return rows.map(([cat, val]) => `<div class="skill-item"><span class="skill-category">${escapeHtml(cat)}:</span> ${escapeHtml(val)}</div>`).join('\n');
}

function summarize(company, title, keywords) {
  const agent = keywords.some((k) => /agent|ai-assisted|workflow|developer/i.test(k));
  const mobile = keywords.some((k) => /android|kotlin|compose|mobile|sdk/i.test(k));
  if (agent && mobile) {
    return `Senior Android and mobile platform engineer with 11+ years building production apps, now targeting ${escapeHtml(title)} at ${escapeHtml(company)} with a blend of Kotlin, Android architecture, AI-assisted development, agent workflows, CI/CD, observability, and security. Proven delivery across CVS Health, Capital One, MoneyGram, Passport, and multi-client mobile teams.`;
  }
  if (agent) {
    return `Senior software and mobile platform engineer with 11+ years of production engineering experience, targeting ${escapeHtml(title)} at ${escapeHtml(company)} through AI agents, workflow automation, developer tooling, CI/CD, observability, and reliable delivery. Brings mobile architecture discipline, platform ownership, and hands-on engineering leadership.`;
  }
  return `Senior Android engineer with 11+ years building and modernizing production mobile apps, targeting ${escapeHtml(title)} at ${escapeHtml(company)} with Kotlin, Jetpack Compose, Android SDK, mobile platform architecture, CI/CD, testing, performance, observability, and app security experience.`;
}

function buildHtml(job, jdText) {
  const keywords = pickKeywords(jdText, job.title);
  const competencies = keywords.slice(0, 8).map((k) => `<span class="competency-tag">${escapeHtml(k)}</span>`).join('\n');
  const replacements = {
    LANG: 'en',
    PAGE_WIDTH: '8.5in',
    NAME: profile.candidate.full_name,
    PHONE: profile.candidate.phone,
    EMAIL: profile.candidate.email,
    LINKEDIN_URL: profile.candidate.linkedin,
    LINKEDIN_DISPLAY: 'LinkedIn',
    PORTFOLIO_URL: profile.candidate.portfolio_url,
    PORTFOLIO_DISPLAY: 'Portfolio',
    LOCATION: profile.candidate.location,
    SECTION_SUMMARY: 'Professional Summary',
    SUMMARY_TEXT: summarize(job.company, job.title, keywords),
    SECTION_COMPETENCIES: 'Core Competencies',
    COMPETENCIES: competencies,
    SECTION_EXPERIENCE: 'Work Experience',
    EXPERIENCE: renderExperience(keywords),
    SECTION_PROJECTS: 'Selected Projects',
    PROJECTS: renderProjects(keywords),
    SECTION_EDUCATION: 'Education',
    EDUCATION: '<div class="edu-item"><div class="edu-header"><div class="edu-title">Bachelor of Technology in Computer Science</div><div class="edu-year">2013</div></div><div class="edu-org">JNTU Hyderabad University</div></div>',
    SECTION_CERTIFICATIONS: 'Certifications',
    CERTIFICATIONS: '<div class="cert-item"><span class="cert-title">No formal certifications listed</span><span class="cert-year"></span></div>',
    SECTION_SKILLS: 'Skills',
    SKILLS: renderSkills(keywords),
  };
  let html = template;
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }
  const fontsDir = path.join(root, 'fonts');
  html = html.replace(/url\(['"]?\.\/fonts\//g, `url('file://${fontsDir}/`);
  html = html.replace(/file:\/\/([^'")]+)\.(woff2?|ttf|otf)['"]?\)/g, `file://$1.$2')`);
  return { html, keywords };
}

async function extractText(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body?.innerText || '');
    return { ok: text.trim().length > 300, text: text.trim(), error: '' };
  } catch (error) {
    return { ok: false, text: '', error: error.message };
  }
}

function pendingJobsFromPipeline(limit = Infinity) {
  const pipeline = fs.readFileSync(path.join(root, 'data/pipeline.md'), 'utf8');
  return pipeline
    .split(/\r?\n/)
    .map((line) => line.match(/^- \[ \] (.+?) \| (.+?) \| (.+?)\s*$/))
    .filter(Boolean)
    .map((m) => ({ url: m[1], company: m[2].trim(), title: m[3].trim() }))
    .slice(0, limit);
}

export async function generateTailoredResumesForJobs(jobs, options = {}) {
  const outputDir = options.outputDir || path.join(root, 'output', `tailored-${today}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const pending = jobs.slice(0, options.limit ?? Infinity);

  if (pending.length === 0) {
    return { outputDir, manifestPath: '', manifest: [] };
  }

  const browser = await chromium.launch({ headless: true });
  const manifest = [];
  try {
    const fetchPage = await browser.newPage();
    for (let i = 0; i < pending.length; i++) {
      const job = pending[i];
      const base = `${filenameSlug(job.company)}_${jobIdFromUrl(job.url, job.title)}`;
      const htmlPath = path.join(outputDir, `${base}.html`);
      const pdfPath = path.join(outputDir, `${base}.pdf`);
      process.stdout.write(`[${i + 1}/${pending.length}] ${job.company} - ${job.title} ... `);
      const jd = await extractText(fetchPage, job.url);
      const { html, keywords } = buildHtml(job, jd.ok ? jd.text : `${job.company} ${job.title}`);
      fs.writeFileSync(htmlPath, html);
      const pdfPage = await browser.newPage();
      await pdfPage.setContent(html, { waitUntil: 'networkidle', baseURL: `file://${root}/` });
      await pdfPage.evaluate(() => document.fonts.ready);
      await pdfPage.pdf({
        path: pdfPath,
        format: 'letter',
        printBackground: true,
        margin: { top: '0.6in', right: '0.6in', bottom: '0.6in', left: '0.6in' },
      });
      await pdfPage.close();
      const item = {
        company: job.company,
        title: job.title,
        url: job.url,
        jd_status: jd.ok ? 'fetched' : `fallback: ${jd.error || 'insufficient text'}`,
        keywords: keywords.join('; '),
        html: path.relative(root, htmlPath),
        pdf: path.relative(root, pdfPath),
        htmlPath,
        pdfPath,
      };
      job.resume = item;
      manifest.push(item);
      console.log(jd.ok ? 'done' : 'done (title fallback)');
    }
  } finally {
    await browser.close();
  }

  const manifestPath = path.join(outputDir, 'manifest.tsv');
  fs.writeFileSync(
    manifestPath,
    ['company\ttitle\turl\tjd_status\tkeywords\thtml\tpdf']
      .concat(manifest.map((m) => [m.company, m.title, m.url, m.jd_status, m.keywords, m.html, m.pdf].map((v) => String(v).replace(/\t/g, ' ')).join('\t')))
      .join('\n')
  );

  return { outputDir, manifestPath, manifest };
}

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const pending = pendingJobsFromPipeline(limit);

  if (pending.length === 0) {
    console.log('No pending jobs found in data/pipeline.md');
    return;
  }

  const result = await generateTailoredResumesForJobs(pending, { limit });
  console.log(`\nGenerated ${result.manifest.length} tailored resume PDF(s).`);
  console.log(`Manifest: ${path.relative(root, result.manifestPath)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Resume generation failed: ${err.message}`);
    process.exit(1);
  });
}
