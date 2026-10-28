# CTIVentures careers (ctiventure.com)

A Lahore AI engineering firm that posts hiring rounds on its LinkedIn company page and links to its own careers site. The apply form is a custom React page, not an ATS.

| Where you were | Control | Next page | Result |
| --- | --- | --- | --- |
| `https://www.linkedin.com/company/cti-ventures-your-ai-engineering-partner/posts/` | post text "Apply / View Careers" `lnkd.in/dCVjB8Mt` | LinkedIn interstitial showing `https://ctiventure.com/careers` | stop. Copy the external URL. |
| `https://ctiventure.com/careers` | role card "Full-Stack Python & AI Engineer" | `https://ctiventure.com/careers/full-stack-python-ai-engineer#apply` | reached. "Apply" anchors carry `#apply`; the form has `id="apply"`. |
| role page `#apply` | fill form, choose resume, tick privacy, "Submit application" | same page | reached. "Application submitted — Thanks for applying … Our team will review and follow up by email." |

Field map for `form#apply`: the inputs carry no `name`/`id` and text inputs have no `type` attribute, so index them inside the form. Order: 0 position (read-only, pre-filled), 1 first name, 2 last name, 3 email, 4 phone, 5 LinkedIn, 6 degree, 7 institution, 8 role/title, 9 company, 10 duration, 11 file, 12 privacy checkbox. Notes is the first `textarea`. The privacy checkbox is the form's first checkbox; the newsletter checkbox lives in the footer form and is not required.

Cookie banner "Decline analytics" sits over the page and is safe to click first. There is a `hr@ctiventure.com` contact on the careers page if the form ever fails.
