# Indeed

```tree
drive: normal_window
port9222: closed
follow: reached success

node home
  see: pk.indeed.com/ and no from=
  action: open_jobs
  branch reached | button full details of {title} | pane
  branch reached | button Find jobs after the title and city are filled | results
  branch stop | address bar viewjob?jk= | verification

node results
  see: pk.indeed.com/jobs?q={query}&l={city}
  action: open_jobs
  branch reached | button full details of {title}; close the date-alert dialog; do not press Activate | pane

node pane
  see: url has vjk= and a link named Apply now
  action: apply_now
  branch reached | link Apply now | contact
  branch reached | link Apply now when contact, location, and the uploaded CV are already stored | review

node verification
  see: Additional Verification Required
  action: stop
  branch stop | leave the page | verification

node contact
  see: contact-info-module
  action: continue
  branch reached | Continue; profile fields are already filled | location

node location
  see: profile-location
  action: set_country
  branch reached | country combo to the profile country; city combo; blank postcode and street; Continue | work_auth

node work_auth
  see: ooc-question
  action: answer_work_auth
  branch reached | Yes when already authorized in the job country; Continue | resume

node resume
  see: resume-selection
  action: select_uploaded_cv
  branch reached | the uploaded profile CV, not Indeed Resume; Continue | review

node review
  see: review-module
  action: submit
  branch reached | button Submit your application; do not scroll the CV preview | post_apply

node post_apply
  see: post-apply
  action: confirm_submitted
  branch success | the page says Your application has been submitted | done
  branch stop | the page does not say the application was submitted | post_apply
```

Stops: "Additional Verification Required" when the debug port is open. A captcha challenge. The reCAPTCHA notice under the form is not that challenge. The review page is not success.

## Discovery navigation (worker scout lane)

Indeed walls cold scripted navigation. The scout's discovery step must NOT `page.goto()` the
`/jobs?q=...` results URL (nor any `viewjob?jk=`). It reaches results the same way a human does:
load `https://pk.indeed.com/`, fill the on-page search (`#text-input-what`, `#text-input-where` =
`Pakistan`), click **Find jobs**. One persistent results tab is kept and re-read across cycles so
re-navigation is rare.

Cadence + backoff (see `src/mcp/indeed-easyapply.js`):
- Normal discovery runs at most once every ~12 minutes (module-level min-interval gate).
- On a Cloudflare wall it hard-backs-off: 20 → 40 → 60 min (cap 60), resetting to 0 after a clean
  cycle. While cooling it returns immediately (`status:'cooling'`) and the scout logs
  `[indeed] cooling … — skipping` WITHOUT navigating.
- The first wall per cooldown period is recorded as an evolution encounter.
- When the cooldown has hit the 60-min cap at least twice (persistent wall), the worker flags the
  user via the dashboard login banner to open Indeed and clear the check manually. Never solve it.
