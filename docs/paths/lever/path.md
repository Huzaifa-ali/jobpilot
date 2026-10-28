# Lever

Apply forms live at `jobs.lever.co/<org>/<jobId>/apply`. Some tenants gate the submit on hCaptcha.

| Where you were | Control | Next page | Result |
| --- | --- | --- | --- |
| `https://jobs.lever.co/packagex/562dbe08-be73-49cb-87c4-35beda715594/apply` | Resume, Full name, Email, Phone, Submit Application | hCaptcha challenge | stop. The "Success!" banner is the resume parser, not a submission; no application POST is sent while hCaptcha is up. Leave it for the person. |

`apply_portal` reported "File exceeds the maximum upload size of 100MB" on this form. Attaching the CV directly to the `resume` input clears that error; the captcha is the remaining stop.
