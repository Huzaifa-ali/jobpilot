# Site paths

Every brain reads the decision tree before it drives a site, and updates that tree in the same change. One directory per site. The tree is the `tree` block in `path.md`. The dashboard Paths tab draws the same block.

Match the page you are on to a `node` by its `see` line. Take a `branch` whose result is `reached` or `success`. Do not take `stop` or `refused`. A `retry` branch is the same node again. `action` is the same name `classifyBoardPage()` returns for Indeed and Glassdoor.

A new page adds a `node` and a `branch` from the node you were on. A wrong hop changes that branch. No personal data, no screenshots, and no tracking query such as `from=`.

- [Setup](setup/path.md) — first clone, or any session with profile gaps. `fresh` to `ready`. Search and outreach are `stop` until the profile exists.
- [Indeed](indeed/path.md) — `home` to `post_apply`. Success is only the submitted sentence.
- [Glassdoor](glassdoor/path.md) — `login` through Google, then `salaries` to `jobs`. Easy Apply is `refused`. The employer site is `company_site`.
- [LinkedIn](linkedin/path.md) — `feed` to `posts`. A security check on `job` is `stop`.
- [Greenhouse](greenhouse/path.md) — follow `embed`. `careers` and `public_job` are `stop`. An empty city field is `stop`.
- [WUR](wur/path.md) — vacancy page form. Click the privacy box, then upload the CV and letter. Success is `ub-form-submitted`.
