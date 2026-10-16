# Glassdoor, then Indeed

Learned 2026-10-16. This is the sign-in path. It is not a way to apply through a driven browser, and it is not a way past a security check.

## What failed

Opening Indeed in the debug Chrome (port 9222, Playwright attached) stops on Cloudflare "Additional Verification Required". There is no email field and no button. Glassdoor in that same driven window stops on "Humans only". `navigator.webdriver` was already false, so flipping that one flag is not the fix. Extra workers attached to the same profile make it worse. Do not spoof a fingerprint and do not solve the check.

## What worked

1. Stop every worker (`data/.stop`) and close the debug Chrome so nothing is listening on 9222.
2. Open the JobPilot profile (`data/chrome-debug-profile`) as a normal Chrome window. No `--remote-debugging-port`.
3. Open Glassdoor's login page first: `https://www.glassdoor.com/profile/login_input.htm`.
4. The person chooses **Continue with Google** and finishes that sign-in.
5. Then Indeed accepts the same Google account. Opening Indeed before this step sticks.

The dashboard and the setup page both have **Open Glassdoor for sign-in**. That button calls `openManualLoginWindow()` and refuses while port 9222 is open.

## After they are signed in

Start one data worker with `npm run agent`. LinkedIn and Gmail stay on the debug Chrome. Company-site links (`resolveIndeed` / `resolveGlassdoor` in `src/mcp/forms.js`) run only when a job page is actually reachable. Easy Apply and SmartApply are still refused. Issues #1 and #2 stay open for applying while a browser is being driven.
