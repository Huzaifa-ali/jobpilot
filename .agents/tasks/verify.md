# Verification — Indeed/Glassdoor Easy Apply

All commands were run from `c:\Users\huzai\Downloads\personal-projects\jobpilot\.worktrees\indeed-easyapply`
on Windows (pwsh). Results recorded here so the reviewer does not need to re-run them.

## 1. Module parses + exports resolve

```
node -e "import('./src/mcp/indeed-easyapply.js').then(m=>console.log(Object.keys(m)))"
→ [ 'indeedEasyApply', 'indeedEasyApplyListings' ]   (exit 0)

node --check src/mcp/indeed-easyapply.js             → exit 0 (no output)
node scripts/_tmp-indeed-check.mjs (throwaway)       → OK exports: indeedEasyApply, indeedEasyApplyListings
```

Both required exports (`indeedEasyApply`, `indeedEasyApplyListings`) are present and are functions.
The throwaway harness `scripts/_tmp-indeed-check.mjs` was created for this check and DELETED
afterward (never committed).

## 2. Changed files parse

```
node --check src/worker.js    → exit 0
node --check mcp-server.js     → exit 0
```

## 3. Worker boots the new lane without throwing (dry, time-boxed)

```
DRY=1 RUN_MS=~18000 node src/worker.js   → exit 0, clean stop, no crash / uncaughtException / unhandledRejection
```

`data/worker-state.json` after the run shows the applier lane reached the new channel's phase:

```
"applier":{"phase":"idle (indeed_easy queue empty)", ...}
```

This confirms the 3-way rotation (LinkedIn easy → `indeed_easy` → form) is wired and the
`indeed_easy` channel runs under the existing supervise()/never-stop machinery. The scout lane
also ran (liPosts attached over CDP :9222) with no error from the new Indeed discovery step.
(No `indeed_easy` leads were in the DB, so the lane correctly idled on an empty queue rather than
hitting the live Indeed site — a full live submit needs the user's logged-in Chrome and may hit a
captcha, so it is not required here.)

## 4. Server still boots

```
JOBPILOT_NO_AUTOWORKER=1 node start.js   (time-boxed ~14s, then stopped)
→ [bootstrap] Debug Chrome already on :9222 — attached
→ [bootstrap] Starting MCP server …
→ [job-agent-mcp] ready — 39 tools over stdio · UI at http://127.0.0.1:7788
```

The full module graph (including the new `indeed` source in the `scrape_fresh` tool) loads with
no import/parse error; the MCP server reaches "ready".

## 5. Security gate

```
node scripts/ci-security-scan.mjs   → ✅ Security gate passed  (exit 0)
```

No `data/`, `.env*`, `uploads/`, DB, profile, CV, or screenshots are staged/tracked. No new
dependencies were added to `package.json` (an incidental `package-lock.json` version-string sync
produced by `npm install` was reverted).

## Behavior notes (design constraints honored)

- **Anti-wall:** discovery and apply navigate to the Pakistan "Easily apply" results page and
  click cards in-page; no `page.goto()` to a `viewjob?jk=` URL anywhere. Walls are detected by
  regex and treated as a cooldown (result `captcha`), never solved. Canonical `viewjob` URLs are
  stored for dedup only.
- **Verified success:** a submit counts only when the popup URL reaches `/form/post-apply` or the
  body says "application has been submitted". A click alone is not success.
- **Captcha discipline:** only a visibly-sized challenge iframe
  (`bframe|hcaptcha challenge|cloudflare challenge`, w>100/h>100/visible) stops the apply; the
  passive invisible reCAPTCHA badge is ignored.
- **Unknown required questions** → `askLater` + leave the app as `draft` (`needs_answers`); never
  guessed or submitted blank.
- **Glassdoor:** discovery-only, routed external/needs_manual; there is intentionally NO Glassdoor
  submit channel (in-site Easy Apply → smartapply is refused). Documented in
  `docs/paths/glassdoor/path.md`.
