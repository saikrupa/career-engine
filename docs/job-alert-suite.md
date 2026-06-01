# Job Alert Suite

This suite searches roles across the portals you enable in `config/job-alerts.yml`, then adds new matches to the pipeline, sends alerts, and generates tailored resumes/PDFs.

## Commands

```bash
npm run setup
npm run alert:dry-run
npm run alert:once
npm run alert:run
npm run scan:linkedin:dry-run
npm run scan:indeed:dry-run
npm run scan:dice:dry-run
npm run scan:naukri:dry-run
```

- `alert:dry-run` tests the searches without writing to `data/pipeline.md`, notifying, or generating PDFs.
- `alert:once` runs one full cycle.
- `alert:run` repeats every 30 minutes using `config/job-alerts.yml`.
- `setup` opens a local dashboard where non-technical users can configure their profile, run one portal or all enabled portals, see current progress, open job links, download tailored resumes, and mark jobs as applied.

## Local Dashboard

Run:

```bash
npm run setup
```

Open <http://127.0.0.1:4321>. The page has two parts:

- Setup form: profile, resume upload, countries, portals, credentials, and portal login buttons.
- Dashboard: run buttons for all enabled portals or a single portal, a compact current-progress line, and the latest actionable matches.

The dashboard intentionally does not show a long terminal log. It only shows the current action, such as `LinkedIn: searching "Android developer" in Dallas, TX`. When a run finishes, it reads `output/last-alert-run.json` and shows source, job link, score, tailored resume PDF, and an applied checkbox.

Applied checkbox state is stored locally in `data/dashboard-status.json`, which is ignored by git with the rest of `data/*`.

For a tiny smoke test:

```bash
node job-alert-suite.mjs once --dry-run --limit-searches 1
```

## Portal And Country Selection

Use `npm run setup` for checkboxes, or edit `config/job-alerts.yml`:

```yaml
active_countries: [us, india]
portals:
  linkedin: true
  indeed: false
  dice: true
  naukri: true
```

Country defaults:

- `us`: LinkedIn, Indeed, Dice
- `india`: LinkedIn, Indeed, Naukri

You can also run one portal/country directly:

```bash
node job-alert-suite.mjs once --portal naukri --country india --dry-run
```

Preflight validation skips portals that are not configured. If Slack/Telegram keys are blank, notifications are disabled for that run instead of failing later.

## Slack Setup

1. In Slack, go to <https://api.slack.com/apps>.
2. Create a new app, choose "From scratch", and select your workspace.
3. Open "Incoming Webhooks" and turn it on.
4. Click "Add New Webhook to Workspace".
5. Pick the channel where you want job alerts.
6. Copy the webhook URL into `.env`:

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

## Telegram Setup

Telegram is configured through:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Keep these values in `.env` or enter them through `npm run setup`. Never put bot tokens,
webhooks, or chat IDs in tracked docs/config files.

## LinkedIn Session

For browser-based portals, prefer a local browser profile. The setup wizard has login buttons, or you can run:

```bash
npm run portal:login -- linkedin
npm run portal:login -- indeed
npm run portal:login -- dice
npm run portal:login -- naukri
```

If you use a Playwright storage-state JSON instead, keep it under `.auth/` or `storage/`.
Then set either:

```env
LINKEDIN_STORAGE_STATE=.auth/linkedin-state.json
```

or `session.linkedin_storage_state` in `config/job-alerts.yml`. The `.env` value wins.
Treat that file like a password because it contains live browser cookies.

## Indeed Bot Checks

Indeed may show bot or captcha challenges. The default setup uses slower, headed browser settings for Indeed:

```yaml
capture:
  portal_overrides:
    indeed:
      headless: false
      search_delay_ms: 4500
      action_delay_ms: 2200
      slow_mo: 200
```

If Indeed still blocks the session, log in again with `npm run portal:login -- indeed`, wait a while, or disable Indeed in setup and use LinkedIn/Dice/Naukri for that run.
