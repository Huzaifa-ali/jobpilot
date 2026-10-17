# Greenhouse

```tree
follow: reached success

node careers
  see: a company vacancy page whose Apply control is not a form
  branch stop | apply on that careers URL | careers

node public_job
  see: job-boards.greenhouse.io/{board}/jobs/{id}
  branch stop | open | description

node description
  see: the company site with gh_jid= and no form
  branch stop | no form on the page | description

node embed
  see: job-boards.greenhouse.io/embed/job_app?for={board}&token={id}
  branch reached | the embedded fields for name, email, phone, and CV | form

node form
  see: the greenhouse embed form
  branch stop | Location (City) stays empty | form
```
