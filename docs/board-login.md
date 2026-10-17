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

Keep port 9222 closed while applying. Starting the debug Chrome or the worker attaches to this profile and the check comes back.

Indeed **Apply now** (the in-site form) is completed in this normal window. On 2026-10-16 one application reached the page "Your application has been submitted". The steps that worked:

- Drive the page's own controls. Do not attach Playwright.
- The contact step was already filled from the Indeed profile. Check it.
- If the country is wrong, change it before continuing. Do not invent a postal code for another country.
- Choose the uploaded CV when it is the profile CV.
- Answer work-authorization from the profile. For a job in a country where the person is already authorized, that answer is yes.
- Submit only when the review is right. Success is the submitted page, not the click.
- Stop if a captcha challenge is shown. The small reCAPTCHA notice under the form is not that challenge.
- Record the job with `save_jobs` and `set_job_status` so it is not sent again.

Glassdoor job pages load in the same window. The button seen there was **Apply on employer site**, which is the company-site path. Glassdoor Easy Apply is still refused. Issue #1 is closed: Indeed Apply now works in this window. Issue #2 stays open for Glassdoor while a browser is being driven on port 9222.

Hop logs, one directory per site: `docs/paths/`.
