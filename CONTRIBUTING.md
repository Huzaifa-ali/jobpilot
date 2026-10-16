# Contributing to JobPilot

Thanks for your interest — contributions are very welcome! JobPilot gets better the more adapters,
lead sources, and resilience fixes the community adds.

## Ground rules

- **Never commit personal data.** Everything under `data/` is gitignored (profile, CV, scraped jobs,
  the logged-in Chrome profile, evolution snapshots). Double-check `git status` before you commit.
- **No credentials in code.** JobPilot deliberately uses the user's own browser sessions — don't add
  API keys, SMTP passwords, or tokens.
- Keep the agent-agnostic design: tools expose **facts** and perform **one concrete action**; the
  reasoning stays in the user's coding agent.

## Dev setup

```bash
git clone https://github.com/<you>/jobpilot
cd jobpilot
npm install
npx playwright install chromium   # if your agent hasn't already
npm run doctor                    # health check
```

Run the MCP server by hand with `npm start`, or the always-on engine with `npm run worker`
(use `DRY=1` to scrape without sending, `RUN_MS=60000` to time-box).

## Great first contributions

- **New ATS adapters** in `src/mcp/forms.js` — add detection + field mapping for an ATS that
  currently lands in "needs you". Use the saved snapshot in `data/evolution/` as your fixture.
- **New lead sources** in `src/mcp/sources.js` — another board or community, returning the standard
  lead shape (`{ role, company, url, email, applyUrl, posterUrl, postedAt, channel, relevance }`).
- **Resilience fixes** — pick an open encounter from your own `data/evolution/PLAYBOOK.md`, reproduce
  it from the saved HTML snapshot, fix the selector/flow, and note it in the PR.

## Pull requests

1. Branch from `main`, keep the change focused.
2. Make sure `node --check` passes on changed files and `npm run doctor` is happy.
3. If you fixed an encounter, describe which signature it addressed.
4. Open the PR with a clear before/after. Screenshots of the dashboard help.

## What gets merged

Every open pull request is reviewed. The author and the `self-evolve` label do not matter.
Contributions are welcome. A pull request that tries to land several unrelated edits at once
is not.

A pull request is merged only when all of these are true:

1. It changes something. An empty diff is closed.
2. It stays on allowlisted code and docs. Anything under `data/`, plus credentials, drafts,
   logs, screenshots, and the database, is sent back.
3. It fixes **one** problem. Title it `fix(area): what changed`. A bundled
   `chore(self-evolve): sync improvements` that touches several modules is closed. Open a
   new pull request per fix. The close comment is the request, not a rejection of the work.
4. It is small enough to check, or a maintainer has reviewed it. Auto-merge is limited to
   **80 changed lines** and **at most two code areas** (docs and tests do not count).
   A larger diff stays open until someone reads it.
5. It does not add email, apply, or connect behavior to `src/worker.js`. The supported
   worker is data-only. Outreach belongs to the brain.
6. It does not duplicate another open pull request. A generic snapshot of a file that a
   named pull request already changes is closed. A smaller patch against a file that a
   larger open pull request rewrites waits until that rewrite lands or is rejected.
7. The `review` check is green. A failing security or syntax check is never bypassed.
8. The current commit has no open "changes requested" review. A newer approval clears it.

Say what was broken and how you checked it. Do not invent personal facts (salary, demographics,
years in a tool) to make a form submit.

## Issues

The open issue list is **unsolved work only**.

- Close an issue once the fix is on `main`.
- Fingerprint audits (`Audit: encounter · …`, `Audit: improvement · …`) and titles that start
  with `self-evolve audit` or `self-evolution audit` are a history, not a queue. Close them.
  Do not reopen one because the event was seen again. The local evolution ledger keeps that.
  `.github/workflows/close-audit-issues.yml` closes a new one on arrival, including from an
  older contributor copy that still files them.
- Keep one issue per real blocker. Duplicates of the same blocker (for example several
  "resolve job-board redirects" issues) are closed in favor of the original.
- Issues that only say "rebase PR #N" are closed once that pull request has merged or the
  behavior is already on `main`.

## Automated self-evolution PRs & the security gate

JobPilot contributes its own improvements back as **pull requests to this repo** (never direct
pushes from forks). Every PR — human or automated — is gated by `.github/workflows/self-evolve-review.yml`:

- **Security gate** (`node scripts/ci-security-scan.mjs`): the merge is blocked if the PR introduces
  any path under `data/`, `.env`, `drafts/`, `applied/`, `logs/`, screenshots, or the DB, or if any
  changed file contains a secret (private key, AWS key, SMTP password, GitHub/Slack token, …).
- **Syntax check** on every changed `.js`/`.mjs`, plus a **boot smoke test** of the MCP server.
- A pull request **auto-merges** only when it passes the "What gets merged" bar above and the
  `review` check is green. The `self-evolve` label does not skip that bar. Branch protection
  on `main` requires the `review` check.

When a fork's agent learns something, it opens the PR **upstream to this repo immediately**, and
keeps its own branch in sync (rebased on `upstream/main`) so contributions never drift. If you'd
rather it stayed local, toggle self-contribution off from the dashboard.

## Reporting bugs

Open an issue using the templates. For a stuck page, attach the (personal-data-redacted) HTML
snapshot or a screenshot from `data/evolution/` — that's exactly what the fix needs.
