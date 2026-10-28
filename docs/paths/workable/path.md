# Workable

Apply forms live at `apply.workable.com/<org>/j/<jobId>/apply/`. Name, email, headline, phone and summary autofill from the profile; the CV goes to the Resume input. Some tenants also show a Photo (avatar) input that is really required, and some ask for a start date from a calendar.

| Where you were | Control | Next page | Result |
| --- | --- | --- | --- |
| `https://apply.workable.com/flatgigs/j/A5785ABDCF/apply/` | Submit application | API 400 `{"avatar":{"url":"Please complete this mandatory field"}}` | stop. The Photo field is required even though labelled optional; no profile photo exists, so the application cannot be completed. Do not attach the CV to the Photo input. |
| `https://apply.workable.com/volga-partners/j/2129823FCF/apply/` | "When will you be available to start?" calendar, desired pay (PKR/month) | same page | stop. The start date is a date picker and a typed answer is rejected; pay needs a numeric value. Leave both for the person. |
