JobPilot cannot currently apply to **Indeed**-hosted postings. When a lead's apply flow
resolves to `indeed.com`, the page presents an anti-automation wall (CAPTCHA / Cloudflare
challenge / login gate), so the applier marks the lead `needs_manual` instead of submitting.

### Where it shows up
- `src/mcp/forms.js` → `applyForm()` detects `indeed.com` in the resolved URL and returns
  `needs_manual` ("redirected to login/aggregator").
- Surfaced in the dashboard **🧬 Evolution** tab as a `form` encounter on `indeed.com`.

### Why it's hard
Indeed aggressively fingerprints automation (navigator.webdriver, canvas/WebGL, timing),
gates "Apply" behind a login + often a CAPTCHA, and rotates DOM/class names. Reliable,
ToS-respecting automation of Indeed apply is not currently feasible from a driven browser.

### What would "done" look like
- Detect Indeed early and **route the lead to a better channel** (company careers page / the
  recruiter's email / LinkedIn) instead of dead-ending.
- Where the posting links to a real ATS behind Indeed, follow through to that ATS.
- Never attempt CAPTCHA solving or ToS-violating evasion.

### Learned sign-in (2026-10-16)
A person can sign in, but not inside the debug Chrome and not by opening Indeed first. Stop the workers, close the debug window, sign in to Glassdoor with Google, then sign in to Indeed with that same Google account. See `docs/board-login.md`. Applying while Playwright is attached is still unsolved. `resolveIndeed()` follows a company-site redirect only when the page is reachable.

### Learned Apply now (2026-10-16)
Apply now works in that same normal window, with the debug port closed. In-site applications on `smartapply.indeed.com` reached "Your application has been submitted". Every agent reads `docs/paths/indeed/path.md` before driving Indeed and adds a row when a new page is reached. The jobs home is `https://pk.indeed.com/`. Do not type `viewjob?jk=` into the address bar. Drive the page controls. Do not attach Playwright and do not solve a captcha challenge. The worker's driven browser still stops on the check. That path is a stop, not an open blocker. Issue #1 is closed.

### Good first contribution
Add an `indeed.com` branch in `forms.js` that extracts the employer's real careers/ATS link
from the Indeed posting (when present) and hands off to the existing ATS flow; otherwise mark
the lead `connect`/`email` so it still gets actioned.

_Labels: blocker, help wanted_
