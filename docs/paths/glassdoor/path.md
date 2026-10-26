# Glassdoor

```tree
drive: normal_window
port9222: closed
follow: reached success

node login
  see: /profile/login_input.htm
  action: continue_with_google
  branch success | Continue with Google | google

node google
  see: window title Sign in - Google Accounts
  branch success | the person finishes Google sign-in | signed_in

node signed_in
  see: signed-in Glassdoor
  branch success | the same Google account on Indeed | indeed_session

node salaries
  see: /Salaries/index.htm
  action: browse_jobs
  branch success | Browse jobs | jobs

node jobs
  see: /Job/index.htm
  action: jobs_open
  branch reached | Apply on employer site | company_site
  branch refused | Easy Apply | smartapply
  branch retry | Whitelabel Error Page | jobs

node company_site
  see: the employer site
  action: company_site
  branch reached | the company form | company_site

node search
  see: a job search on Glassdoor
  branch reached | a job card opens Create job alert | alert
  branch refused | Easy Apply | smartapply

node alert
  see: dialog Create job alert
  branch reached | the dialog close control | search

node debug
  see: a debug window on Glassdoor, Humans only
  action: stop
  branch stop | leave the page | debug
```

The jobs list is the page that loaded. In-site Apply now on Glassdoor has not been submitted.

## Routing decision (implemented)

Glassdoor Pakistan listings are DISCOVERED but ROUTED as external/needs_manual: in-site Easy
Apply resolves to `smartapply.indeed.com` and is refused, so there is intentionally NO Glassdoor
submit channel. Indeed is the only real submitting path. If Glassdoor discovery is wired later it
must save leads with a non-`indeed_easy` channel (e.g. `form`/`connect`) so the applier never
attempts a fake Glassdoor submit.

| From | Option | To | Result |
|---|---|---|---|
| Glassdoor Pakistan job list | discovery only | lead routed needs_manual | no in-site submit |
