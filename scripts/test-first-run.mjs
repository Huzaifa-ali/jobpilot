// Empty profile must not invent a persona or a region.
import { queriesFromProfile, listingQueriesFromProfile } from '../src/mcp/queries.js';

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log('ok', name);
  else { failed++; console.error('FAIL', name); }
};

const empty = { preferences: { roles: [], locations: [], remoteOnly: true, locationScope: 'worldwide' }, workAuth: {}, country: '' };
const post = queriesFromProfile(empty);
const list = listingQueriesFromProfile(empty);
check('empty profile has no post queries', post.length === 0);
check('empty profile has no listing queries', list.length === 0);

const japan = {
  country: 'Japan',
  preferences: { roles: ['Backend Engineer'], locations: ['Japan'], remoteOnly: false, locationScope: 'country' },
  workAuth: { willingToRelocate: true },
};
const jp = queriesFromProfile(japan).join('\n');
check('uses the profile country', jp.includes('Japan'));
check('does not invent another region', !/pakistan|middle east|karachi|europe/i.test(jp));
check('does not invent a role', !/devops|site reliability/i.test(jp));

if (failed) process.exit(1);
console.log('first-run query checks passed');
