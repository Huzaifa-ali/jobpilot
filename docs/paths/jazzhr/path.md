# JazzHR (applytojob.com)

Pakistani employers often post a hiring note on LinkedIn and point to a JazzHR career page. The apply page is a single long form; the submit control is a styled link, not a button, and a reCAPTCHA checkbox guards the submit.

| Where you were | Control | Next page | Result |
| --- | --- | --- | --- |
| `https://www.linkedin.com/feed/update/urn:li:activity:7521150634180423680/` (NorthBay hiring post) | city apply links `lnkd.in/...` | LinkedIn "not on LinkedIn" interstitial listing `northbay.applytojob.com/apply/<id>/Senior-AI-Engineer` | stop. Interstitial only; copy the external URL. |
| `https://northbay.applytojob.com/apply/32qfQ3OWtD/Senior-AI-Engineer` (Karachi) | fill first/last/email/phone, city, state, resume, LinkedIn, desired salary, current salary, notice period, two essay questions | same page | form stays. Required IDs: `#resumator-firstname-value`, `-lastname-`, `-email-`, `-phone-`, `-city-`, `-state-`, `-linkedin-`, `-salary-`, `#resumator-questionnaire-q2651812` (current salary), `q2651813` (notice days), q2726564 and q2876254 textareas. Resume is `#resumator-resume-value` (hidden input, `setInputFiles` works). |
| same page | `a#resumator-submit-resume` ("SUBMIT APPLICATION") | same page | stop. "Human Check — Please verify." because the visible reCAPTCHA "I'm not a robot" checkbox is unchecked. |

The visible "Apply" button (`#resumator-mobile-apply-button`) is hidden on desktop; clicking it times out. Submit only happens through `a#resumator-submit-resume`.

Do not tick the reCAPTCHA. The form can be filled completely and handed to the user for the checkbox, or the recruiter can be reached through LinkedIn instead.
