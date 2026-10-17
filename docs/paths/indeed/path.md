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
