# Job Alert Suite

This suite searches Android-related roles across LinkedIn and Indeed, keeps only Remote, Dallas/DFW, and Texas matches, then adds new matches to the pipeline, sends alerts, and generates tailored resumes/PDFs.

## Commands

```bash
npm run alert:dry-run
npm run alert:once
npm run alert:run
```

- `alert:dry-run` tests the searches without writing to `data/pipeline.md`, notifying, or generating PDFs.
- `alert:once` runs one full cycle.
- `alert:run` repeats every 30 minutes using `config/job-alerts.yml`.

For a tiny smoke test:

```bash
node job-alert-suite.mjs once --dry-run --limit-searches 1
```

## Current Policy

- Remote United States roles are first priority and alerts show `REMOTE PRIORITY - APPLY ASAP`.
- Dallas/DFW roles are A1 local matches.
- Texas roles are A2 matches.
- Other locations are excluded unless the job detail page says Remote.
- Android roles always alert when location matches.
- Non-Android matches need score `50+/100`.

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

The local `.env` can reuse values from your `job_hunter_agent` project.

## LinkedIn Session

The suite uses this approved local storage-state file:

```text
/Users/puram.2194292/bala_projects/job_hunter_agent/storage/linkedin_state.json
```

Treat that file like a password because it contains live browser cookies.
