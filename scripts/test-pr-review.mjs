// Rules for assessUsefulness. Run: node scripts/test-pr-review.mjs
import {
  assessUsefulness, mergeBlockedByReview, maintainerApproved, AUTO_MERGE_MAX_CHURN,
} from '../src/contribute.js';

let failed = 0;
function check(name, cond) {
  if (cond) console.log('ok  ', name);
  else { failed++; console.error('FAIL', name); }
}

const bundleFiles = [
  'README.md', 'src/cv.js', 'src/dashboard/index.js', 'src/mcp/answers.js', 'src/mcp/connect.js',
  'src/mcp/easyapply.js', 'src/mcp/forms.js', 'src/mcp/gmail.js', 'src/profile.js', 'src/tracker.js', 'src/worker.js',
];
const bundle = assessUsefulness({
  number: 796, title: 'chore(self-evolve): sync improvements + file discovered blockers',
  changedFiles: bundleFiles.length, additions: 371, deletions: 87,
  files: bundleFiles,
}, [], [{ number: 783, title: 'chore(self-evolve): sync improvements + file discovered blockers', changedFiles: 13, additions: 357, deletions: 87, files: bundleFiles }]);
check('grab bag closes', bundle.action === 'close' && bundle.useful === false);

const empty = assessUsefulness({ number: 1, title: 'fix(gmail): x', changedFiles: 0, additions: 0, deletions: 0, files: [] });
check('empty closes', empty.action === 'close' && empty.empty === true);

const secret = assessUsefulness({
  number: 2, title: 'fix(profile): tweak', changedFiles: 1, additions: 3, deletions: 0,
  files: ['data/profile.json'],
});
check('secret path is sent back', secret.action === 'request_changes');

const sources600 = {
  number: 600, title: 'fix: repair job scrapers', changedFiles: 1, additions: 135, deletions: 67,
  files: ['src/mcp/sources.js'],
};
const genericSources = assessUsefulness({
  number: 595, title: 'chore(self-evolve): sync improvements + file discovered blockers',
  changedFiles: 1, additions: 89, deletions: 23, files: ['src/mcp/sources.js'],
}, [], [sources600]);
check('generic snapshot closes behind a named PR', genericSources.action === 'close' && /600/.test(genericSources.reason));

const big = assessUsefulness(sources600);
check('large named diff waits', big.action === 'hold' && big.churn !== 0 || big.action === 'hold');

const salary = assessUsefulness({
  number: 549, title: 'fix(easyapply): normalize gross salary questions',
  changedFiles: 2, additions: 8, deletions: 8,
  files: ['src/mcp/answers.js', 'src/mcp/easyapply.js'],
});
check('small two-area fix merges', salary.action === 'merge' && salary.useful === true);
check('size bar is 80', AUTO_MERGE_MAX_CHURN === 80);

const worker = assessUsefulness({
  number: 704, title: 'feat(outreach): prioritize cold email over Easy Apply',
  changedFiles: 2, additions: 15, deletions: 1,
  files: ['src/profile.js', 'src/worker.js'],
});
check('worker.js waits', worker.action === 'hold' && /worker/.test(worker.reason));

const smallConnect = assessUsefulness({
  number: 576, title: 'fix(connect): scope invite lookup to visible dialogs',
  changedFiles: 1, additions: 4, deletions: 1, files: ['src/mcp/connect.js'],
}, [], [{
  number: 586, title: 'fix(connect): robust LinkedIn invite Send-button detection',
  changedFiles: 1, additions: 186, deletions: 143, files: ['src/mcp/connect.js'],
}]);
check('small patch waits on a larger rewrite', smallConnect.action === 'hold' && /586/.test(smallConnect.reason));

const loneGeneric = assessUsefulness({
  number: 9, title: 'Automated self-evolution contribution',
  changedFiles: 1, additions: 12, deletions: 1, files: ['src/mcp/gmail.js'],
});
check('untitled generic fix is sent back', loneGeneric.action === 'request_changes');

const head = 'abc';
check('changes requested blocks', mergeBlockedByReview([
  { state: 'CHANGES_REQUESTED', submittedAt: '2026-10-16T00:00:00Z', commit: { oid: head } },
], head));
check('later approval clears the block', mergeBlockedByReview([
  { state: 'CHANGES_REQUESTED', submittedAt: '2026-10-16T00:00:00Z', commit: { oid: head } },
  { state: 'APPROVED', submittedAt: '2026-10-16T01:00:00Z', commit: { oid: head }, author: { login: 'maazbin' } },
], head) === false);
check('old review does not block a new commit', mergeBlockedByReview([
  { state: 'CHANGES_REQUESTED', submittedAt: '2026-10-16T00:00:00Z', commit: { oid: 'old' } },
], 'new') === false);

const held = { action: 'hold' };
check('author cannot approve their own hold', maintainerApproved(held, [
  { state: 'APPROVED', submittedAt: '2026-10-16T01:00:00Z', commit: { oid: head }, author: { login: 'AbdullahBM' } },
], head, 'AbdullahBM') === false);
check('other maintainer can approve a hold', maintainerApproved(held, [
  { state: 'APPROVED', submittedAt: '2026-10-16T01:00:00Z', commit: { oid: head }, author: { login: 'maazbin' } },
], head, 'AbdullahBM') === true);

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all passed');
