# Instagram

```tree
follow: reached success

node home
  see: instagram.com/ and the signed-in profile
  branch reached | the search page | search
  branch reached | the inbox | inbox

node search
  see: instagram.com/explore/search/keyword
  branch reached | a hiring post from the last day | status
  branch stop | the visible posts are older than a day | search

node status
  see: instagram.com/p/{code}/
  branch reached | an apply link on the post | job
  branch stop | the role names an office city and does not say remote | status

node job
  see: the employer application the post linked
  branch stop | the page names an office city and does not say remote | job

node inbox
  see: instagram.com/direct/inbox/
  branch stop | the thread is a personal chat or a promotion | inbox
```
