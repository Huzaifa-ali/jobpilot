# X

```tree
follow: reached success

node home
  see: x.com/home
  branch reached | the search box, Latest | search

node search
  see: x.com/search with f=live
  branch reached | a hiring post in the results | status

node status
  see: x.com/{handle}/status/{id}
  branch reached | the reply control on the post | reply
  branch reached | a t.co link on the post | job

node reply
  see: the reply composer
  branch success | the note is on the post and the composer is empty | status
  branch retry | the composer is open and the note is still in it | reply

node job
  see: the page the post linked
  branch reached | an employer application on jobs.ashbyhq.com | application

node application
  see: jobs.ashbyhq.com/{company}/{id}/application
  branch success | the page shows the application was submitted | application
  branch stop | a required field has no profile answer | application
```
