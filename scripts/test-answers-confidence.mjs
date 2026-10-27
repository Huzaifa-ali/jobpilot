// scripts/test-answers-confidence.mjs — the answer engine must answer EVERY required
// field confidently from the profile so Easy Apply / forms never stall in a
// skip→retry→skip loop. Pure test: a profile is injected, data/profile.json untouched.
import { textAnswer, choiceAnswer } from '../src/mcp/answers.js';

let fail = 0;
const check = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (cond ? '' : ` (got: ${JSON.stringify(got)})`));
  if (!cond) fail++;
};

const profile = {
  name: 'Test User', firstName: 'Test', lastName: 'User',
  email: 'test@example.com', phone: '+923001234567',
  location: 'Karachi, Pakistan', country: 'Pakistan',
  yearsExperience: 5, headline: 'Senior Software Engineer',
  skills: ['Python', 'FastAPI', 'AWS'],
  summary: 'I build and ship production software end to end.',
  salaryExpectations: [{ country: 'Pakistan', min: 280000, max: 350000, currency: 'pkr', period: 'month' }],
  workAuth: { authorizedIn: ['Pakistan'], needsSponsorship: false, willingToRelocate: true },
  links: { linkedin: 'https://linkedin.com/in/test', github: 'https://github.com/test' },
  answers: {}, preferences: { roles: ['Backend Engineer'] },
};

// Required free-text yes/no-phrased capability question → confident "Yes", never null.
const cap = textAnswer('Do you have experience building REST APIs?', { profile });
check('capability yes/no free-text answered', cap != null && /yes/i.test(cap), cap);

// Required numeric "how many years" with profile set → the profile number.
const yrs = textAnswer('How many years of experience do you have?', { numeric: true, profile });
check('numeric years from profile', yrs === '5', yrs);

// Required numeric with NO profile value → must still be non-null (0), never park.
const emptyProfile = { ...profile, yearsExperience: 0, answers: {} };
const yrsNone = textAnswer('How many widgets have you shipped?', { numeric: true, profile: emptyProfile });
check('numeric with no profile value → non-null', yrsNone != null && yrsNone !== '', yrsNone);

// Salary question → numeric, currency-aware (existing behavior preserved).
const sal = textAnswer('What is your expected monthly salary?', { numeric: true, profile });
check('salary numeric non-null', sal != null && /\d/.test(String(sal)), sal);

// Single-choice with no obvious profile match → a safe non-null option.
const choice = choiceAnswer('Which shift do you prefer?', ['Morning', 'Evening', 'Flexible'], { profile });
check('single-choice no-match → safe non-null option', choice != null && ['Morning', 'Evening', 'Flexible'].includes(choice), choice);

// Legal screening (convicted) → safe standard answer, non-null, from Yes/No options.
const legal = choiceAnswer('Have you ever been convicted of a felony?', ['Yes', 'No'], { profile });
check('legal screening → safe standard non-null', legal != null && /no/i.test(legal), legal);

// Consent/agreement → Yes.
const consent = choiceAnswer('Are you willing to undergo a background check?', ['Yes', 'No'], { profile });
check('consent → yes', consent != null && /yes/i.test(consent), consent);

// Work-auth where user IS authorized → answerable (authorized = Yes).
const auth = choiceAnswer('Are you legally authorized to work in Pakistan?', ['Yes', 'No'], { profile });
check('work-auth in authorized country → yes', auth != null && /yes/i.test(auth), auth);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
