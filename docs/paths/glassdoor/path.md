# Glassdoor

Normal window. Open Glassdoor before Indeed. Issue #2 stays open for the driven browser.

| From | Option | To | Result |
|---|---|---|---|
| `https://www.glassdoor.com/profile/login_input.htm` | Continue with Google | signed-in Glassdoor | success |
| Indeed, after that Google sign-in | the same Google account | Indeed accepts the account | success |
| `https://www.glassdoor.com/Salaries/index.htm` | Browse jobs. Do not write a review or add a salary | `https://www.glassdoor.com/Job/index.htm` | success |
| `/Job/index.htm` | Apply on employer site | the company site | seen, not submitted |
| `/Job/index.htm` | Easy Apply | smartapply.indeed.com | refused |
| `/Job/index.htm` | — | Whitelabel Error Page | retry, not a login wall |
| debug window on Glassdoor | — | Humans only | stop |
| Netherlands senior software engineer search | a job card | dialog "Create job alert" | reached. Close that dialog with its own close control. Do not press Save this alert. The browser window Close button is not the dialog close. |
| that search | Easy Apply | — | refused |

The jobs list is the page that loaded. In-site Apply now on Glassdoor has not been submitted.
