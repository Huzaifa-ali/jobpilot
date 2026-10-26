import { countryLocked, keepRemoteOrVisaEnabled, leadKeep, score } from '../src/mcp/sources.js';

const places = ['Netherlands', 'Germany', 'Luxembourg', 'Europe', 'EU'];
const profile = {
  skills: ['python'],
  preferences: { roles: ['Senior Software Engineer'], skip: [], keywords: ['python'], locations: places },
  workAuth: { willingToRelocate: true },
};
const off = { ...profile, preferences: { ...profile.preferences, keepRemoteOrVisa: false } };

let fail = 0;
const check = (name, value) => { console.log((value ? 'PASS' : 'FAIL') + ' - ' + name); if (!value) fail++; };

check('missing switch is on', keepRemoteOrVisaEnabled({ preferences: {} }));
check('explicit off is off', keepRemoteOrVisaEnabled(off) === false);

const keep = (text, p = profile) => leadKeep(text, p);
check('timezone overlap stays', keep('Senior Software Engineer. REMOTE (US Timezones). Python.').keep);
check('us only remote skips', keep('REMOTE (US only). Senior Software Engineer.').keep === false);
check('us-only phrase skips', keep('This role is US-only and remote.').why === 'remote is limited to a country list');
check('remote dash us skips', countryLocked('Remote - US, senior software engineer'));
check('remote comma us timezones stays', countryLocked('Remote, US timezones overlap') === false);
check('europe timezone overlap stays', keep('Remote (Europe timezones). CET overlap is enough.').keep);
check('worldwide remote stays even when sponsorship is refused', keep('Fully remote, worldwide. No visa sponsorship.').keep);
check('onsite london without an offer skips', keep('Onsite in London. No visa sponsorship.').why === 'onsite or hybrid without visa or relocation in a listed place');
check('onsite listed place without an offer skips', keep('Onsite in Amsterdam, Netherlands.').keep === false);
check('onsite plus visa in a listed place stays', keep('Onsite in Amsterdam. Visa sponsorship. Netherlands.').keep);
check('hybrid plus relocation in a listed place stays', keep('Hybrid in Berlin. Relocation package. Germany.').keep);
check('no visa sponsorship is not an offer', keep('Onsite. No visa sponsorship in the Netherlands.').keep === false);
check('eu does not match inside another word', keep('Onsite. Visa sponsorship. Join the queue.').keep === false);
check('eu as a word with an offer stays', keep('Onsite. Visa sponsorship for the EU.').keep);
check('switch off keeps a us-only role', keep('REMOTE (US only).', off).keep);
check('text with no location stays', keep('Senior Software Engineer. Python and PostgreSQL.').keep);

const scored = (text, p = profile) => score(text, 'Senior Software Engineer', p);
check('score keeps a timezone overlap', scored('REMOTE (US Timezones). Python FastAPI.').skip === false);
check('score skips a country-locked remote role', scored('REMOTE (US only). Python.').why === 'remote is limited to a country list');
check('score skips onsite without an offer', scored('Onsite in Amsterdam, Netherlands. Python.').skip);
check('score keeps onsite when visa names a listed place', scored('Onsite Amsterdam. Visa sponsorship. Netherlands. Python.').skip === false);
check('switch off restores the old geo reason', scored('US only remote. Python.', off).why === 'location-restricted / authorization');
check('switch off still keeps a listed place with no offer', scored('Onsite in Amsterdam, Netherlands. Python.', off).skip === false);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
