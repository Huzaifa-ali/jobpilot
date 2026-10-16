# Indeed

Normal window, debug port closed. Issue #1 stays open for the driven browser.

| From | Option | To | Result |
|---|---|---|---|
| `https://pk.indeed.com/?from=gnav-homepage--homepage-frontend` | Apply now on a job card | `smartapply.indeed.com/beta/indeedapply/form/contact-info-module` | reached |
| contact-info-module, "Add your contact information" | Continue. The profile fields were already filled | `.../profile-location` | reached |
| profile-location, "Add or update your address" | Combo "Select a country" to the profile country (the default was United States). City combo "City, province/territory". Leave postcode and street blank. Continue | `.../ooc-question` | reached |
| ooc-question | Yes when already authorized in the job country. Continue | `.../resume-selection-module/resume-selection` | reached |
| resume-selection | The uploaded profile CV, not "Use your Indeed Resume". Continue | `.../review-module` | reached |
| review-module, 100% | Submit your application. Do not scroll inside the CV preview | `.../post-apply` | reached |
| post-apply | The page says "Your application has been submitted" | — | success |

Stops: "Additional Verification Required" when the debug port is open. A captcha challenge. The reCAPTCHA notice under the form is not that challenge. The review page is not success.
