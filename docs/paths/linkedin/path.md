# LinkedIn

```tree
drive: normal_window
port9222: closed while this window is also the Indeed session
follow: reached success

node feed
  see: linkedin.com/feed/
  branch reached | address bar, content search "we are hiring" "software engineer", sortBy=date_posted | posts

node posts
  see: search posts, Latest
  branch reached | wheel the results column; skip posts that are not on the profile | posts

node job
  see: linkedin.com/jobs/view/
  branch stop | Easy Apply while a security check is up | checkpoint

node checkpoint
  see: LinkedIn security check or a captcha
  action: stop
  branch stop | leave the check | checkpoint
```
