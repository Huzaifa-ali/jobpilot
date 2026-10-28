# Ashby

Hosted boards live at `jobs.ashbyhq.com/<org>/<jobId>`; the form is at `/application`. There is no captcha on submit. Required custom questions differ per org, so read the form before filling.

| Where you were | Control | Next page | Result |
| --- | --- | --- | --- |
| `https://jobs.ashbyhq.com/kodifly/df5965d6-8d0e-4fdb-8a29-7993f18ebb42/application` | Name, Email, Phone, questions, Resume, Submit Application | Success: "Your application was successfully submitted." | reached. Education is a radio group (Undergraduate / Masters / PhD or Higher). The notice-period text box did not commit with a plain fill; typing then Tab did. |
| that form | Submit Application with education or notice empty | same page, "Your form needs corrections" | stop. The GraphQL `formErrors` names the missing fields; fill them and submit again. |
| `https://jobs.ashbyhq.com/imagineart/da9b6541-a1d7-4666-babe-4d9c113f1206/application` | Name, Email, LinkedIn link, portfolio link, current salary, Resume | Success | reached. Resume is the last file input; the first file input on some forms is a separate upload. |

A fill that leaves a required field empty is not a submission failure to retry blindly — read `formErrors` from the network response first.
