# Site paths

Every brain reads this log before it drives a site, and updates it in the same change. This is required. One directory per site. `path.md` is the hop log: the URL you were on, the option that was used, the page that came next, and the result. Follow a `success` or `reached` hop. Do not follow `stop` or `refused`. When a later run reaches a new page, add a row. When a later run shows a row was wrong, correct that row. No personal data, no screenshots, and no tracking query such as `from=`.

`classifyBoardPage()` in `src/mcp/board-pages.js` names the same actions. These hops were completed in the normal window. Port 9222 stays closed. A captcha challenge is a stop, not a step to solve.

- [Indeed](indeed/path.md) — Apply now reached the submitted page.
- [Glassdoor](glassdoor/path.md) — sign-in, then Salaries to the jobs list. In-site apply was not submitted.
- [LinkedIn](linkedin/path.md) — signed-in feed in the normal window, then a latest-posts search. A security check on a job view is a stop.
- [Greenhouse](greenhouse/path.md) — use the embed form. The public job URL can bounce back to the description. A city field that stays empty is a stop.
