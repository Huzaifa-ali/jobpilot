import { classifyBoardPage as c } from '../src/mcp/board-pages.js';
const cases = [
  ['https://smartapply.indeed.com/beta/indeedapply/form/contact-info-module', 'protected by reCAPTCHA', 'contact', 'continue', 'normal_window'],
  ['https://smartapply.indeed.com/beta/indeedapply/form/profile-location', '', 'location', 'set_country', 'normal_window'],
  ['https://smartapply.indeed.com/beta/indeedapply/form/ooc-question', '', 'work_auth', 'answer_work_auth', 'normal_window'],
  ['https://smartapply.indeed.com/beta/indeedapply/form/resume-selection-module/resume-selection', '', 'resume', 'select_uploaded_cv', 'normal_window'],
  ['https://smartapply.indeed.com/beta/indeedapply/form/review-module', '', 'review', 'submit', 'normal_window'],
  ['https://smartapply.indeed.com/beta/indeedapply/form/post-apply', 'Your application has been submitted!', 'submitted', 'submitted', 'normal_window'],
  ['https://smartapply.indeed.com/beta/indeedapply/form/post-apply', '', 'post-apply', 'confirm_submitted', 'normal_window'],
  ['https://pk.indeed.com/viewjob?jk=1', '', 'job', 'apply_now', 'normal_window'],
  ['https://pk.indeed.com/?from=gnav-homepage--homepage-frontend', '', 'home', 'open_jobs', 'normal_window'],
  ['https://pk.indeed.com/?from=gnav-homepage', 'Additional Verification Required', 'challenge', 'stop', 'none'],
  ['https://www.glassdoor.com/profile/login_input.htm', '', 'login', 'continue_with_google', 'normal_window'],
  ['https://www.glassdoor.com/Job/index.htm', '', 'jobs', 'jobs_open', 'normal_window'],
  ['https://www.glassdoor.com/Job/index.htm', 'Apply on employer site', 'jobs', 'company_site', 'company_site'],
  ['https://www.glassdoor.com/Job/index.htm', 'Easy Apply', 'easy_apply', 'refuse', 'none'],
  ['https://www.glassdoor.com/Job/index.htm', 'Whitelabel Error Page', 'error', 'retry', 'none'],
  ['https://www.glassdoor.com/Salaries/index.htm', 'Browse jobs', 'salaries', 'browse_jobs', 'normal_window'],
  ['https://www.glassdoor.com/Job/index.htm', 'Humans only', 'challenge', 'stop', 'none'],
  ['https://boards.greenhouse.io/x', '', null, null, null],
];
let bad = 0;
for (const [url, text, step, action, drive] of cases) {
  const r = c({ url, text });
  const ok = step == null ? r == null : r?.step === step && r?.action === action && r?.drive === drive;
  if (!ok) { bad++; console.error('FAIL', step, r); }
}
if (c({ url: 'not a url' })) { bad++; console.error('FAIL bad url'); }
console.log(bad ? `FAIL ${bad}` : `ok ${cases.length}`);
process.exit(bad ? 1 : 0);
