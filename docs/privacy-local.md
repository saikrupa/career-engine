# Local Privacy and Data Flow

career-engine is a local project. It does not upload your files by default, but some commands intentionally contact external services.

## What leaves your machine

- `node scan.mjs` calls public job board APIs such as Greenhouse, Ashby, and Lever. It sends normal HTTP requests for job listings, not your resume.
- `node update-system.mjs check` contacts GitHub to compare the local career-engine version with the remote version.
- `node gemini-eval.mjs` sends the job description, prompt, and your CV content to Google Gemini when `GEMINI_API_KEY` is configured.
- `npm run portal:capture -- linkedin|indeed --url "..."` uses your local logged-in browser profile. LinkedIn or Indeed can see normal logged-in browsing activity.
- `npm run portal:capture -- linkedin --url "..." --storage-state storage/linkedin_state.json` can reuse a Playwright storage-state file from another local project. That file contains live cookies and should be treated like a password.
- Slack and Telegram alerts send job title, company, location, source, score, and URL to those services. Resume/CV content is not included by default.

## What stays local

- `cv.md`, `config/profile.yml`, `modes/_profile.md`, `data/pipeline.md`, `data/applications.md`, `reports/`, `output/`, and `.env` are ignored by git in this repo.
- LinkedIn/Indeed browser sessions are stored under `.browser-profiles/`, which is also ignored by git.
- Optional Playwright storage-state files under `storage/` are ignored by git.
- Application assist fills fields in your local browser and stops before final Submit/Send/Apply.

## Practical safeguards

- Keep `.env` private. It can contain AI keys, Slack webhooks, and Telegram bot credentials.
- Treat `.browser-profiles/` like a password vault. Anyone with local access to your machine may be able to use those sessions.
- Review Slack and Telegram channel membership before enabling alerts.
- Do not commit generated resumes, reports, or browser session files.
- Use `npm run portal:capture -- ... --dry-run` before saving jobs from a new search page.

## Terms and account risk

LinkedIn and Indeed restrict scraping and automated application activity. The portal assistant is intentionally human-in-the-loop: you manually log in, run captures intentionally, and review applications yourself. It does not bypass CAPTCHA, run hidden unattended scraping, or click final submit.
