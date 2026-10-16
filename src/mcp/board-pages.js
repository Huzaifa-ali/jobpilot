// Page bases that worked for Indeed and Glassdoor. No browser and no captcha solving.
// drive "normal_window" stays off port 9222. "company_site" is the employer ATS.

const CHALLENGE = /additional verification required|humans only|verify you are human/i;
const INDEED = [
  ['contact-info', 'contact', 'continue', 'Indeed contact step: continue when the profile is already filled.'],
  ['profile-location', 'location', 'set_country', 'Indeed location step: set the real country. Leave a blank postcode.'],
  ['ooc-question', 'work_auth', 'answer_work_auth', 'Indeed work-auth step: answer from the profile.'],
  ['resume-selection', 'resume', 'select_uploaded_cv', 'Indeed resume step: choose the uploaded profile CV.'],
  ['review-module', 'review', 'submit', 'Indeed review step: submit only when the review is right. This page is not success.'],
];
const row = (board, step, action, drive, detail) => ({ board, step, action, drive, detail });

export function classifyBoardPage({ url = '', text = '', label = '' } = {}) {
  const blob = `${text}\n${label}`;
  let host = '', path = '';
  try { const u = new URL(url); host = u.hostname.toLowerCase(); path = u.pathname.toLowerCase(); }
  catch { return null; }
  const board = host.endsWith('glassdoor.com') ? 'glassdoor' : 'indeed';
  if (CHALLENGE.test(blob)) return row(board, 'challenge', 'stop', 'none', 'A captcha challenge stops the apply.');
  if (host === 'smartapply.indeed.com') {
    if (path.includes('post-apply')) {
      const ok = /your application has been submitted/i.test(blob);
      return row('indeed', ok ? 'submitted' : 'post-apply', ok ? 'submitted' : 'confirm_submitted', 'normal_window', 'Count success only when the page says the application was submitted.');
    }
    const hit = INDEED.find(([part]) => path.includes(part));
    return hit ? row('indeed', hit[1], hit[2], 'normal_window', hit[3]) : row('indeed', 'smartapply', 'stop', 'none', 'Unknown Indeed Apply page. Leave the debug port closed.');
  }
  if (host.endsWith('indeed.com')) {
    if (path === '/' || path === '') {
      return row('indeed', 'home', 'open_jobs', 'normal_window', 'Indeed jobs open at pk.indeed.com/. A from= tracking parameter is not part of the page.');
    }
    return row('indeed', 'job', 'apply_now', 'normal_window', 'Indeed Apply now stays in the normal window. Leave the debug port closed.');
  }
  if (board !== 'glassdoor') return null;
  if (path.includes('/profile/login_input')) return row('glassdoor', 'login', 'continue_with_google', 'normal_window', 'Open Glassdoor login first and use Continue with Google.');
  if (/whitelabel error page/i.test(blob)) return row('glassdoor', 'error', 'retry', 'none', 'A Glassdoor whitelabel error is a retry, not a login wall.');
  if (path.includes('/salaries/')) return row('glassdoor', 'salaries', 'browse_jobs', 'normal_window', 'Start at glassdoor.com/Salaries/index.htm and choose Browse jobs. That opens /Job/index.htm.');
  if (/easy apply/i.test(blob)) return row('glassdoor', 'easy_apply', 'refuse', 'none', 'Glassdoor Easy Apply stays refused.');
  if (/apply on (employer|company) site/i.test(blob)) return row('glassdoor', 'jobs', 'company_site', 'company_site', 'Glassdoor Apply on employer site is the company-site path.');
  if (path.includes('/job/')) return row('glassdoor', 'jobs', 'jobs_open', 'normal_window', 'Glassdoor /Job/index.htm is the working jobs list, reached from Salaries via Browse jobs.');
  return null;
}
