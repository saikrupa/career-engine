# Bala Job Scan Context

Use this file as context for future AI/Codex/Claude sessions. It documents how Bala expects job scanning, filtering, dedupe, notifications, and pipeline updates to behave.

## Goal

Bala is using Career Engine as a focused job-search command center, not a bulk application tool. The scanner should find fresh, high-fit roles and avoid repeatedly showing jobs that were already shared, added, skipped, evaluated, or applied to.

Primary target lanes:

- Senior Android / Kotlin Engineer
- Lead Mobile Engineer
- Mobile Platform / Mobile Foundation Engineer
- Android Architecture / Modernization Engineer
- AI-enabled Mobile Engineer
- AI Agents / AI Automation Engineer when it is genuinely engineering-aligned

Lower-priority adjacent lanes:

- AI infrastructure / AI tooling roles if they fit Bala's mobile/platform/AI-assisted engineering story
- Solutions / Forward Deployed roles only if they are technical and relevant

Avoid noisy roles:

- Sales, account executive, marketing, pure product manager
- iOS-only, Swift-only, Flutter-only, React Native-only unless Android/Kotlin/KMP is explicit
- Java/.NET/backend-only roles unless they are clearly AI tooling/infrastructure and worth review
- QA/SDET/test automation, UX/UI/design, fitness/mechanic/diesel roles
- Non-US roles, unless Bala explicitly changes the location policy

## Commands

API/company-board scanner:

```bash
npm run scan
```

LinkedIn-only scanner:

```bash
npm run scan:linkedin
```

LinkedIn dry run, no writes:

```bash
npm run scan:linkedin:dry-run
```

Indeed-only scanner:

```bash
npm run scan:indeed
```

Indeed dry run, no writes:

```bash
npm run scan:indeed:dry-run
```

Notification test:

```bash
npm run notify:test
```

Pipeline health check:

```bash
npm run verify
```

## Dry Run Meaning

Dry run means test without saving anything. It can open the browser, search, scroll, capture jobs, and print what it would add, but it should not modify:

- `data/pipeline.md`
- `data/scan-history.tsv`
- notifications
- generated PDFs/resumes

## Location Preference

Preferred location policy:

- P1: Remote roles open to the United States
- P2: Hybrid/office-linked Dallas or DFW roles
- P3: Texas roles
- P4 exclusion: skip US-citizen-only, green-card-only, or "no sponsorship/unable to sponsor" roles

For LinkedIn/Indeed:

- Remote searches should use remote filters and should not send a radius parameter.
- Dallas searches should use an 80-mile radius.
- Texas searches should not use a radius by default because Texas is state-level.

The config lives in:

- `config/profile.yml` for scan location preferences
- `config/job-alerts.yml` for LinkedIn/Indeed locations, keywords, radius, capture behavior, and actions

## LinkedIn Filters

LinkedIn searches use these locations:

- `Remote United States`
- `Dallas, TX`
- `Texas`

LinkedIn search keywords:

- `Senior Android Engineer Kotlin`
- `Mobile Platform Android`
- `Android Kotlin Jetpack Compose`
- `Android SDK Engineer`

LinkedIn URL-level filters:

- Posted in last 24 hours: `f_TPR=r86400`
- Remote filter for Remote United States: `f_WT=2`
- Dallas radius: `distance=80`
- Remote/Texas: no radius

Capture behavior:

- Uses saved LinkedIn session from `config/job-alerts.yml`
- Browser is visible, not headless
- Uses slower action delays and `slow_mo` so it behaves less aggressively
- Captures across scroll positions because LinkedIn virtualizes job lists
- Captures up to 2 pages and multiple scroll passes per search
- Opens/clicks detail views for only a limited number of jobs per search

## LinkedIn Post-Capture Keep Rules

A job must pass location classification and title/skill filtering before notification/pipeline add.

Location keep buckets:

- Remote / work from home / anywhere in US
- Dallas / Plano / Irving / Frisco / Fort Worth / Arlington / Richardson / Addison / DFW
- Texas / Austin / Houston / San Antonio

Reject clear non-US signals:

- Canada, India, UK, Germany, France, Ireland, Spain, Australia, Japan, etc.

Title must contain a target signal such as:

- Android
- Kotlin
- Jetpack
- Compose
- KMP
- Mobile
- Application Developer
- App Developer
- SDK
- AI Infrastructure
- AI Tooling

Reject obvious noise unless Android/Kotlin/KMP is explicit:

- iOS, Swift, Objective-C
- Flutter, React Native
- Roblox, Rails, Elixir/Erlang
- .NET, Java
- Designer, Product Manager
- Fitness trainer, mechanic, diesel
- Sales, Account Executive
- Test automation, SDET, QA
- UX/UI roles

## Score Behavior

The score is a lightweight relevance score, not a final application recommendation.

Base score: 35.

Boosts:

- Strong terms like Android, Kotlin, Jetpack, Compose, KMP, SDK, mobile platform, AI agents: `+9` each
- Good terms like platform, architecture, developer tools, automation, AI, LLM, senior, lead, staff: `+4` each
- Remote: `+20`
- Dallas/DFW: `+16`
- Texas: `+8`
- H1B/visa/sponsorship mention: `+5`

Default minimum score:

- `50`

Android-related jobs can pass if the location/title filters pass, even when score logic is imperfect.

## Fresh Jobs Only

Bala expects future scans to send only fresh jobs.

Anything shared with Bala should be recorded as seen so it is ignored in the next run.

Seen/dedupe sources:

- `data/scan-history.tsv`
- `data/pipeline.md`
- `data/applications.md`

Dedup behavior:

- Normalize LinkedIn URLs to `https://www.linkedin.com/jobs/view/{id}/`
- Normalize Indeed URLs to `https://www.indeed.com/viewjob?jk={id}`
- Skip jobs already seen by URL
- Skip jobs already in pipeline/applications by company + role where possible
- Deduplicate again within the same run

If a job was accidentally shared but later removed as noise, update `data/scan-history.tsv` from `added` to a skipped status such as `skipped_title` so the audit trail stays accurate.

## Pipeline Behavior

Active pending jobs live in:

```text
data/pipeline.md
```

Expected format:

```markdown
- [ ] {url} | {company} | {title}
```

API scanner may add priority tags:

```markdown
- [ ] {url} | {company} | {title} | P1
```

Do not repeatedly add the same job. If it already exists in pipeline/history/applications, skip it.

After cleanup, run:

```bash
npm run verify
```

## Notifications

Notifications are sent by `notify-alerts.mjs`.

Slack:

- Uses `SLACK_WEBHOOK_URL` in `.env`
- Incoming Webhook posts only to the selected Slack channel
- Successful Slack response is `ok`

Telegram:

- Uses `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

Notification expectations:

- Every job message includes match score:

```text
Match score: 95%
```

- Remote Android-style jobs with score `>= 60` should start with:

```text
🚨🚨🚨 [REMOTE]
```

- Other remote jobs use:

```text
[REMOTE]
```

- Non-remote matches use:

```text
[MATCH]
```

Example message:

```text
🚨🚨🚨 [REMOTE] REMOTE PRIORITY - APPLY ASAP
Company - Senior Android Engineer | Remote - United States | linkedin
Match score: 95%
Posted: 2 hours ago
Easy Apply: Yes
https://www.linkedin.com/jobs/view/...
```

## Current Automation Preferences

For LinkedIn/Indeed scans:

- Add matching jobs to `data/pipeline.md`
- Notify Slack and Telegram
- Do not auto-generate tailored resumes after scan
- Keep scans bounded; do not let a portal scan become endless
- Prefer separate LinkedIn and Indeed runs over combined runs
- Treat Indeed as lower priority when it shows bot verification

Configured action preference:

```yaml
actions:
  add_to_pipeline: true
  notify: true
  generate_tailored_resumes: false
```

## Known Observations

LinkedIn:

- LinkedIn can show repeated or overlapping results across keyword/location searches.
- LinkedIn virtualizes job lists, so the scraper must collect across scrolls, not only the final visible list.
- LinkedIn sometimes injects unrelated jobs despite specific search terms; keep post-capture filtering strict.

Indeed:

- Indeed often shows bot/verification pages.
- Run Indeed separately from LinkedIn.
- Do not let Indeed failures block LinkedIn scans.

Playwright/browser:

- Browser runs often need elevated permissions outside the sandbox.
- Use separate portal commands and bounded search limits if the run is taking too long.

## When Future AI Should Make Changes

If Bala asks to change filtering, prefer editing:

- `config/job-alerts.yml` for LinkedIn/Indeed search behavior
- `config/profile.yml` for personal location/policy preferences
- `job-alert-suite.mjs` only for scanner logic changes
- `portal-assist.mjs` only for capture, scoring, dedupe, or browser behavior
- `notify-alerts.mjs` only for notification formatting/delivery

Do not put Bala-specific preferences into shared mode files like `modes/_shared.md`.

## Quick Checklist For Future Sessions

Before running scans:

1. Check `data/pipeline.md` for current pending jobs.
2. Check `data/scan-history.tsv` if dedupe seems wrong.
3. Use dry run first for major filter changes.
4. Prefer `npm run scan:linkedin` over combined LinkedIn+Indeed.
5. Use `npm run notify:test` after changing notification formatting.
6. Run `npm run verify` after editing pipeline/tracker data.

