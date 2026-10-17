# Greenhouse

Company career sites often show Apply and keep the form on an embed. The public job-board URL can bounce back to the description.

| Where you were | Control | Next page | Result |
| --- | --- | --- | --- |
| `https://jobs.picnic.app/en/vacancies/J4RU8AM7/engineering/ai-platform-engineer/amsterdam/north-holland/netherlands` | apply on that careers URL | same vacancy | stop. No form on the page. |
| `https://job-boards.greenhouse.io/teampicnic/jobs/8239169` | open | `https://jobs.picnic.app/nl/vacancies?gh_jid=8239169` | stop. Description page, no form. |
| `https://job-boards.greenhouse.io/embed/job_app?for=teampicnic&token=8239169` | embedded application | form (name, email, phone, CV) | reached. Submit stops while Location (City) is empty. |

Follow the embed URL. Do not repeat the two stop URLs. A city autocomplete that does not keep the typed city is a stop until that field accepts the profile location.
