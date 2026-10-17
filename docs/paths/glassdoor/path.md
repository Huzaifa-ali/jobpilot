# Glassdoor

```tree
drive: normal_window
port9222: closed
follow: reached success

node login
  see: /profile/login_input.htm
  action: continue_with_google
  branch success | Continue with Google | signed_in

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
