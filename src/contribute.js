// src/contribute.js — the "self-improving repository" loop.
//
// Flow:
//   Fork  →  sync with upstream/main (rebase)  →  open a PR to upstream
//   Main  →  ff-merge origin/main              →  review + merge open self-evolve PRs
//
// Hard-guarded:
//   • Only allowlisted paths (src/, docs/, scripts/, *.md, mcp-server.js, etc.) may be staged.
//   • A DENY list aborts immediately if data/, .env*, drafts/, applied/, logs/, screenshots,
//     or the DB ever appear in the index.
//   • The CI security gate (scripts/ci-security-scan.mjs) re-checks on every PR.
//   • Commits are attributed to the repo owner; no personal email is ever committed.
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { ROOT, DATA } from './config.js';
import {
  openEncounters,
  recordEvolutionAudit,
} from './evolve.js';

const run = promisify(execFile);
const git = (...a) => run('git', a, { cwd: ROOT }).then(r => r.stdout.trim())
  .catch(e => { throw new Error((e.stderr || e.stdout || e.message).slice(0, 300)); });
const gh  = (...a) => run('gh',  a, { cwd: ROOT }).then(r => r.stdout.trim());

function parseGitHubRepo(raw = '') {
  const s = String(raw).trim().replace(/\.git$/, '');
  const m = s.match(/github\.com[:/]([^/]+\/[^/]+)$/i);
  return m ? m[1] : '';
}

// ── Author identity ─────────────────────────────────────────────────────────
// Commits are attributed to the GitHub USERNAME (e.g. "maazbin"), NOT a real name or a
// random name, using the account's noreply email so no personal email is ever committed.
let _ident = null;
/**
 * Resolve the commit identity from the authenticated GitHub account.
 * Returns { name: <login>, email: <id>+<login>@users.noreply.github.com }.
 * Cached for the process. Falls back to the local git user if gh is unavailable.
 * @returns {Promise<{name:string, email:string}>}
 */
async function ghIdentity() {
  if (_ident) return _ident;
  try {
    const login = await gh('api', 'user', '--jq', '.login');
    const id    = await gh('api', 'user', '--jq', '.id');
    _ident = { name: login, email: `${id}+${login}@users.noreply.github.com` };
  } catch {
    const name  = await git('config', 'user.name').catch(() => 'jobpilot');
    const email = await git('config', 'user.email').catch(() => 'jobpilot@users.noreply.github.com');
    _ident = { name, email };
  }
  return _ident;
}

/**
 * Commit staged changes authored AND committed as the GitHub username (via -c overrides),
 * so attribution is the actual username regardless of local/global git config.
 * @param {string} message
 */
async function commitAs(message) {
  const id = await ghIdentity();
  await git(
    '-c', `user.name=${id.name}`,
    '-c', `user.email=${id.email}`,
    'commit', '--author', `${id.name} <${id.email}>`, '-m', message,
  );
}

// ── Allowlist / denylist ──────────────────────────────────────────────────────
const ALLOW = [
  /^src\//, /^docs\//, /^scripts\//, /^\.github\//, /^[^/]+\.md$/,
  /^mcp-server\.js$/, /^start\.js$/, /^package(-lock)?\.json$/,
  /^\.gitignore$/, /^\.env\.example$/, /^LICENSE$/,
];
const DENY = [
  /^data\//, /^\.env$/, /^\.env\.[^x]/, /\.env$/, /^drafts\//, /^applied\//, /^logs\//,
  /\.log$/, /jobs\.db$/, /profile\.json$/, /chrome-debug/, /\.png$/, /\.html$/, /uploads\//,
];

async function staged() {
  return (await git('diff', '--cached', '--name-only')).split('\n').filter(Boolean);
}

/**
 * Stage only allowlisted paths, then hard-abort if anything sensitive slipped in.
 * @returns {string[]} list of staged files
 */
async function safeStage() {
  await git('add', '--',
    'src', 'docs', 'scripts', '.github',
    'mcp-server.js', 'start.js', 'package.json', 'package-lock.json',
    '.gitignore', '.env.example', 'LICENSE',
    'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'CODING_STANDARDS.md',
  ).catch(() => {});
  const files = await staged();
  const bad = files.filter(f => DENY.some(re => re.test(f)) || !ALLOW.some(re => re.test(f)));
  if (bad.length) {
    await git('reset').catch(() => {});
    throw new Error('ABORT: sensitive/non-allowlisted paths staged: ' + bad.slice(0, 8).join(', '));
  }
  return files;
}

// ── Repo topology ─────────────────────────────────────────────────────────────

/**
 * Determine repo identity: is this a fork? who is upstream?
 * @returns {Promise<{origin, owner, upstream, base, isFork}>}
 */
export async function repoInfo() {
  // Prefer the checkout's remotes. `gh repo view` can resolve the authenticated
  // upstream repository even when this checkout is a fork, which would make a
  // cross-fork PR look like a same-repository branch and fail with "no commits".
  const originRemote = parseGitHubRepo(await git('remote', 'get-url', 'origin').catch(() => ''));
  const upstreamRemote = parseGitHubRepo(await git('remote', 'get-url', 'upstream').catch(() => ''));
  try {
    const j = JSON.parse(await gh('repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,parent'));
    const parentName = j.parent?.nameWithOwner || (j.parent?.owner?.login && j.parent?.name ? `${j.parent.owner.login}/${j.parent.name}` : '');
    const origin = originRemote || j.nameWithOwner;
    const upstream = upstreamRemote || parentName || j.nameWithOwner;
    return {
      origin,
      owner:    origin.split('/')[0],
      upstream,
      base:     j.defaultBranchRef?.name || 'main',
      isFork:   (Boolean(originRemote && upstreamRemote && originRemote !== upstreamRemote) || !!j.parent),
    };
  } catch {
    // `gh repo view` can fail in a worktree without a GitHub repository context.
    // Fall back to the configured remotes so self-evolution never constructs
    // an invalid `gh pr create --repo` invocation.
    const origin = parseGitHubRepo(await git('remote', 'get-url', 'origin').catch(() => ''));
    const upstreamRemote = parseGitHubRepo(await git('remote', 'get-url', 'upstream').catch(() => ''));
    const upstream = upstreamRemote || origin;
    return {
      origin,
      owner: origin.split('/')[0] || '',
      upstream,
      base: 'main',
      isFork: !!upstreamRemote && upstreamRemote !== origin,
    };
  }
}

/**
 * Pull the latest code from upstream BEFORE doing anything:
 *   Fork  — fetch upstream/main and rebase. If rebase conflicts, abort cleanly (leave as-is).
 *            Then push the fork's base branch so the fork itself stays current.
 *   Main  — fetch origin/main and fast-forward merge.
 *
 * This is called at the top of every contributeRound() so we always work from the newest code.
 * @returns {Promise<{synced, advanced, reason?}>}
 */
export async function syncBranch() {
  const info = await repoInfo();
  const { base, upstream, isFork } = info;
  try {
    if (isFork && upstream) {
      // Ensure upstream remote exists
      const remotes = await git('remote').catch(() => '');
      if (!/\bupstream\b/.test(remotes)) {
        await git('remote', 'add', 'upstream', `https://github.com/${upstream}.git`).catch(() => {});
      }
      await git('fetch', 'upstream', base).catch(() => {});
      await git('checkout', base).catch(() => {});
      const before = await git('rev-parse', 'HEAD').catch(() => '');
      const result = await git('rebase', `upstream/${base}`)
        .catch(async () => { await git('rebase', '--abort').catch(() => {}); return 'conflict'; });
      if (result === 'conflict') {
        return { ...info, synced: false, reason: 'rebase conflict — left branch as-is, will retry next cycle' };
      }
      const after = await git('rev-parse', 'HEAD').catch(() => '');
      if (before !== after) {
        // Push updated fork branch so it stays current with upstream
        await git('push', 'origin', base).catch(() => {});
      }
      return { ...info, synced: true, advanced: before !== after };
    }

    // Main repo (not a fork): fast-forward merge from origin
    await git('fetch', 'origin', base).catch(() => {});
    await git('checkout', base).catch(() => {});
    await git('merge', '--ff-only', `origin/${base}`).catch(() => {});
    return { ...info, synced: true };
  } catch (e) {
    return { ...info, synced: false, reason: e.message };
  }
}

/**
 * Open a PR from a feature branch to upstream/main.
 * Works for both forks (cross-fork PR) and the main repo itself.
 * Returns to the original branch when done.
 * Hard-guarded — aborts if anything sensitive would be staged.
 * @param {string} message - commit/PR title
 * @returns {Promise<{pr?, pushed, files?, reason?}>}
 */
export async function contributeViaPR(message) {
  const info = await repoInfo();
  const { base, upstream, owner, isFork } = info;
  if (!upstream || !owner) return { ...info, pushed: false, reason: 'GitHub repository identity unavailable' };
  const startBranch = (await git('rev-parse', '--abbrev-ref', 'HEAD').catch(() => base)) || base;
  const branch = `self-evolve/${Date.now()}`;
  try {
    // Stage on current branch first — if nothing changed, skip
    let files;
    try { files = await safeStage(); } catch (e) { return { pushed: false, reason: e.message }; }
    if (!files.length) return { pushed: false, reason: 'nothing to contribute' };
    const improvementAudit = recordEvolutionAudit('improvement', `${message}|${files.join('|')}`, { needsCode: true });
    await git('reset').catch(() => {});           // unstage; commit on a dedicated branch

    await git('checkout', '-b', branch);
    await safeStage();                             // re-stage + re-check on the new branch
    await commitAs(message);                       // author as the GitHub username
    await git('push', '-u', 'origin', branch);

    const head = isFork ? `${owner}:${branch}` : branch;
    const body = [
      'Automated self-evolution contribution from JobPilot.',
      '',
      '- Only allowlisted code/doc paths (never `data/`, `.env`, drafts, logs, screenshots, or the DB).',
      '- Gated by the security review workflow before merge.',
      '',
      `_Files changed: ${files.join(', ')}_`,
    ].join('\n');

    const url = await gh(
      'pr', 'create',
      '--repo', upstream,
      '--base', base,
      '--head', head,
      '--title', message,
      '--body', body,
      '--label', 'self-evolve',
    );
    // Enable auto-merge once CI passes. Use a MERGE commit (not squash) so the author line
    // we set — the GitHub username — is preserved verbatim (squash lets GitHub rewrite the
    // author to the account's profile display name).
    await gh('pr', 'merge', '--auto', '--merge', url).catch(() => {});
    return { pr: url, pushed: true, files, audit: improvementAudit };
  } catch (e) {
    return { pushed: false, reason: e.message };
  } finally {
    await git('checkout', startBranch).catch(() => {});
  }
}

// Fingerprint audits and "self-evolve audit" notes are a history, not the work
// queue. The open issue list is only work that still needs a fix.
const AUDIT_ISSUE_TITLE = /^(audit:|self-evolution audit:|self-evolve audit:)/i;

/**
 * Close audit issues that are still open. Does not create issues and does not
 * reopen them when the local ledger still says "open" — that flag means the
 * event was seen, not that a maintainer must act. Real blockers are filed by
 * {@link fileBlockerIssues} under their own titles.
 * @returns {Promise<{created:string[], reopened:string[], closed:string[], linked:string[], reason?:string}>}
 */
export async function syncEvolutionAuditIssues() {
  const info = await repoInfo();
  const repo = info.upstream || info.origin;
  if (!repo) return { created: [], reopened: [], closed: [], linked: [], reason: 'repository identity unavailable' };
  const closed = [];
  let remote = [];
  try {
    remote = JSON.parse(await gh('issue', 'list', '--repo', repo, '--state', 'open', '--limit', '500', '--json', 'number,title,url'));
  } catch (e) {
    return { created: [], reopened: [], closed, linked: [], reason: e.message };
  }
  for (const issue of remote) {
    if (!AUDIT_ISSUE_TITLE.test(issue.title || '')) continue;
    try {
      await gh(
        'issue', 'close', String(issue.number),
        '--repo', repo,
        '--reason', 'not planned',
        '--comment', 'Closed by JobPilot: this is an audit record, not an open bug. The issue list stays limited to work that still needs a fix. Encounter history stays in the local evolution ledger. A real unsolved blocker keeps its own issue title.',
      );
      closed.push(issue.url);
    } catch { /* already closed or no permission */ }
  }
  return { created: [], reopened: [], closed, linked: [] };
}

/**
 * Approve pending CI for PRs from forks (first-time / external contributors). GitHub holds
 * their workflow runs in `action_required` until a maintainer approves — otherwise the `review`
 * security gate never runs and the PR can never be safely merged. As the repo owner we approve
 * those runs so the security gate executes. We NEVER merge on the strength of this approval alone —
 * the PR still only merges once the `review` gate actually concludes SUCCESS.
 * @param {string} repo - owner/name
 * @returns {Promise<string[]>} ids of runs approved
 */
async function approveForkCIRuns(repo) {
  const approved = [];
  try {
    const raw = await gh('api', `repos/${repo}/actions/runs?status=action_required&per_page=50`, '--jq', '.workflow_runs[].id');
    const ids = (raw || '').split('\n').map(s => s.trim()).filter(Boolean);
    for (const id of ids) {
      try { await gh('api', '--method', 'POST', `repos/${repo}/actions/runs/${id}/approve`); approved.push(id); } catch {}
    }
    // Also handle runs explicitly 'waiting' for approval
    const raw2 = await gh('api', `repos/${repo}/actions/runs?status=waiting&per_page=50`, '--jq', '.workflow_runs[].id').catch(() => '');
    for (const id of (raw2 || '').split('\n').map(s => s.trim()).filter(Boolean)) {
      if (approved.includes(id)) continue;
      try { await gh('api', '--method', 'POST', `repos/${repo}/actions/runs/${id}/approve`); approved.push(id); } catch {}
    }
  } catch {}
  return approved;
}

// ── Linked-issue resolution ────────────────────────────────────────────────────

/**
 * Resolve the issue(s) a PR is intended to address, so usefulness is judged against real intent
 * rather than labels. Combines two signals:
 *   • GitHub's native linkage — `closingIssuesReferences` (set via "Fixes #N" or the PR UI).
 *   • The PR body — "Fixes/Closes/Resolves #N" closing keywords (strong) AND any bare "#N"
 *     mention (weak/context, e.g. "the top recurring encounter (#20, x48)").
 * Each referenced issue is fetched (title/state/body) and returned, deduped by number. Fetch
 * failures (e.g. the number is actually a PR, or doesn't exist) are tolerated and skipped.
 *
 * @param {string} repo - owner/name of the repo the PR targets
 * @param {{number:number, body?:string}} pr
 * @returns {Promise<Array<{number:number,title:string,state:string,body:string,closing:boolean}>>}
 */
export async function linkedIssuesFor(repo, pr) {
  const closing = new Set();   // strong: this PR closes the issue
  const mentioned = new Set(); // weak: referenced for context
  const body = pr.body || '';

  // Closing keywords in the body.
  const closeRe = /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi;
  let m;
  while ((m = closeRe.exec(body))) closing.add(Number(m[1]));
  // Any other bare "#N" reference → context only.
  const bareRe = /(?<![\w/])#(\d+)\b/g;
  while ((m = bareRe.exec(body))) {
    const n = Number(m[1]);
    if (!closing.has(n)) mentioned.add(n);
  }

  // GitHub's own closing linkage (authoritative for the "closing" set).
  try {
    const [owner, name] = repo.split('/');
    const q = 'query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name)' +
      '{pullRequest(number:$num){closingIssuesReferences(first:20){nodes{number}}}}}';
    const raw = await gh('api', 'graphql', '-f', `query=${q}`,
      '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `num=${pr.number}`);
    const nodes = JSON.parse(raw)?.data?.repository?.pullRequest?.closingIssuesReferences?.nodes || [];
    for (const n of nodes) { closing.add(n.number); mentioned.delete(n.number); }
  } catch {}

  const out = [];
  for (const n of [...closing, ...mentioned]) {
    try {
      const raw = await gh('issue', 'view', String(n), '--repo', repo, '--json', 'number,title,state,body');
      const j = JSON.parse(raw);
      out.push({ number: j.number, title: j.title, state: j.state, body: j.body || '', closing: closing.has(n) });
    } catch { /* not an issue / inaccessible — skip */ }
  }
  return out;
}

// ── Usefulness assessment (label-independent, testable, pure) ───────────────────
// Auto-merge is only for a small, named, single-purpose fix. Anything else stays
// open with a comment, or is closed when it cannot be reviewed as one change.
// Author and the self-evolve label are never an input. See CONTRIBUTING.md.

/** Changed lines (adds + deletes) above which a PR waits for a maintainer. */
export const AUTO_MERGE_MAX_CHURN = 80;

const GENERIC_PR_TITLE = /^\s*(chore\(self-evolve\):\s*sync improvements|automated self-evolution)\b/i;

/** @param {string} [title] */
export function isGenericPrTitle(title = '') {
  return GENERIC_PR_TITLE.test(String(title || ''));
}

/** @param {string} p */
function isDocOrTest(p) {
  return /^(README|AGENTS|CONTRIBUTING|CODING_STANDARDS)\.md$/.test(p)
    || p.startsWith('docs/')
    || p.startsWith('scripts/test-')
    || p.startsWith('.github/');
}

/**
 * Code areas a pull request touches. Docs and tests do not count as a second
 * problem. `src/mcp/easyapply.js` → `mcp/easyapply.js`.
 * @param {string[]} paths
 * @returns {string[]}
 */
export function productionAreas(paths = []) {
  const areas = new Set();
  for (const p of paths) {
    if (!p || isDocOrTest(p)) continue;
    if (p.startsWith('src/mcp/')) areas.add('mcp/' + p.split('/')[2]);
    else if (p.startsWith('src/dashboard/')) areas.add('dashboard');
    else if (p.startsWith('src/')) areas.add(p.split('/').slice(0, 2).join('/'));
    else areas.add(p);
  }
  return [...areas];
}

/** @param {{files?:Array<{path:string}|string>}} pr */
export function prPaths(pr) {
  return (pr.files || []).map(f => (typeof f === 'string' ? f : f.path)).filter(Boolean);
}

/** @param {{additions?:number, deletions?:number}} pr */
export function prChurn(pr) {
  return (pr.additions || 0) + (pr.deletions || 0);
}

function issueNote(linkedIssues) {
  const closing = linkedIssues.filter(i => i.closing).map(i => '#' + i.number);
  const ctx = linkedIssues.filter(i => !i.closing).map(i => '#' + i.number);
  const bits = [];
  if (closing.length) bits.push(`closes ${closing.join(', ')}`);
  if (ctx.length) bits.push(`refs ${ctx.join(', ')}`);
  return bits.length ? ` (${bits.join('; ')})` : '';
}

function verdict(partial, linkedIssues = []) {
  const addressesOpenIssue = linkedIssues.some(i => (i.state || '').toUpperCase() === 'OPEN');
  return {
    useful: partial.action === 'merge',
    empty: !!partial.empty,
    action: partial.action,
    addressesOpenIssue,
    reason: partial.reason,
    comment: partial.comment,
  };
}

/**
 * Decide what to do with a pull request. Labels and author are ignored.
 *
 *   • empty                                      → close
 *   • sensitive or non-allowlisted paths         → request changes
 *   • bundled / generic multi-area sync          → close, ask for one fix per PR
 *   • generic snapshot of a file another PR owns → close as duplicate
 *   • worker.js (outreach lanes)                 → hold for a brain review
 *   • churn above {@link AUTO_MERGE_MAX_CHURN}   → hold for a brain review
 *   • smaller patch under a larger rewrite       → hold until the rewrite lands
 *   • one named fix inside the size bar          → merge once CI is green
 *
 * @param {{number?:number, title?:string, changedFiles?:number, additions?:number, deletions?:number, files?:Array<{path:string}|string>}} pr
 * @param {Array<{number:number, state?:string, closing?:boolean}>} [linkedIssues]
 * @param {Array<{number:number, title?:string, files?:Array, additions?:number, deletions?:number}>} [peers] other open PRs
 * @returns {{useful:boolean, empty:boolean, action:'merge'|'close'|'request_changes'|'hold', addressesOpenIssue:boolean, reason:string, comment:string}}
 */
export function assessUsefulness(pr, linkedIssues = [], peers = []) {
  const changedFiles = pr.changedFiles || prPaths(pr).length || 0;
  const churn = prChurn(pr);
  const paths = prPaths(pr);
  const note = issueNote(linkedIssues);
  const title = pr.title || '';

  if (changedFiles === 0 || churn === 0) {
    return verdict({
      empty: true, action: 'close',
      reason: 'no net changes against base (empty/redundant)',
      comment: 'Thanks for the pull request. It has no changes against the base branch, so it is already merged or empty. Closing it. A follow-up that fixes one specific bug is welcome.',
    }, linkedIssues);
  }

  if (paths.length) {
    const bad = paths.filter(p => DENY.some(re => re.test(p)) || !ALLOW.some(re => re.test(p)));
    if (bad.length) {
      return verdict({
        action: 'request_changes',
        reason: 'touches sensitive/non-allowlisted paths: ' + bad.slice(0, 6).join(', '),
        comment: 'Thanks for the pull request. It cannot be merged because it touches paths JobPilot never publishes (`data/`, credentials, drafts, logs, screenshots, or the database): '
          + bad.slice(0, 6).join(', ')
          + '. Please drop those files and resubmit only the code or doc fix. Personal data stays on the machine that scraped it.',
      }, linkedIssues);
    }
  }

  const areas = productionAreas(paths);
  const generic = isGenericPrTitle(title);
  const others = (peers || []).filter(p => p.number !== pr.number);

  if (areas.length >= 3 || changedFiles >= 8 || (generic && areas.length >= 2)) {
    return verdict({
      action: 'close',
      reason: `bundle of ${areas.length} code area(s) across ${changedFiles} file(s); one problem per pull request`,
      comment: [
        'Thanks for sending this in. JobPilot cannot review a bundled sync as one change, so this pull request is closed rather than merged.',
        '',
        `It touches ${changedFiles} file(s)${areas.length ? ` across ${areas.slice(0, 8).join(', ')}` : ''}. A title like \`chore(self-evolve): sync improvements\` does not say which bug is fixed, and the description often names only one of the files.`,
        '',
        'Please open one pull request per fix:',
        '- title the behavior, for example `fix(gmail): retry send when compose stays open`',
        '- change only the module that fix needs, plus a test when you have one',
        '- say what was broken and how you checked it',
        '',
        'The security review stays required. Author and the self-evolve label are not reasons to merge. Focused follow-ups will be reviewed.',
      ].join('\n'),
    }, linkedIssues);
  }

  if (generic) {
    const specific = others.find(p => !isGenericPrTitle(p.title) && productionAreas(prPaths(p)).some(a => areas.includes(a)));
    if (specific) {
      return verdict({
        action: 'close',
        reason: `generic snapshot overlaps #${specific.number}, which names the change`,
        comment: `Thanks. This is an automated snapshot and it overlaps #${specific.number} ("${specific.title || 'the other pull request'}"), which describes the same area. Closing this copy so there is one review. Please put any extra fix onto #${specific.number}, or open a new pull request whose title names one bug.`,
      }, linkedIssues);
    }
    const earlierTwin = others.find(p => p.number < (pr.number || 0) && isGenericPrTitle(p.title) && productionAreas(prPaths(p)).some(a => areas.includes(a)));
    if (earlierTwin) {
      return verdict({
        action: 'close',
        reason: `duplicate generic snapshot of #${earlierTwin.number}`,
        comment: `Thanks. This is a duplicate of #${earlierTwin.number} (same automated title, same area). Closing this copy. Please resubmit as one named fix if the work is still needed.`,
      }, linkedIssues);
    }
    return verdict({
      action: 'request_changes',
      reason: 'generic self-evolve title does not name the bug',
      comment: 'Thanks. The diff may be useful, but the title `chore(self-evolve): sync improvements` does not say what it fixes, so it will not be auto-merged. Please retitle it to the behavior (`fix(area): what changed`) and drop any edit that is not part of that one fix.',
    }, linkedIssues);
  }

  if (paths.includes('src/worker.js')) {
    return verdict({
      action: 'hold',
      reason: 'worker.js changes are not auto-merged; outreach stays with the brain',
      comment: [
        'Thanks. This changes `src/worker.js`, so it waits for a maintainer review instead of auto-merging.',
        '',
        'The supported worker is data-only (`WORKER_DATA_ONLY=1`): it scrapes leads and does not email, apply, or connect. Those choices belong to the brain. Please do not add send, apply, or connect behavior to the worker lanes. A scout-only bugfix can stay open for review; say that in the title.',
      ].join('\n'),
    }, linkedIssues);
  }

  if (churn > AUTO_MERGE_MAX_CHURN) {
    return verdict({
      action: 'hold',
      reason: `${churn} changed lines is above the auto-merge bar of ${AUTO_MERGE_MAX_CHURN}`,
      comment: `Thanks. This looks like a single area (${areas.join(', ') || 'docs'}), but it changes ${churn} lines, which is above the auto-merge bar of ${AUTO_MERGE_MAX_CHURN}. It stays open for a maintainer to read. If part of the diff is a separate fix, please split that into its own pull request so the rest can land faster.`,
    }, linkedIssues);
  }

  const primary = areas[0];
  if (primary) {
    const larger = others
      .map(p => ({ p, areas: productionAreas(prPaths(p)), churn: prChurn(p) }))
      .find(x => x.areas.includes(primary) && x.areas.length <= 2 && x.churn >= Math.max(100, churn * 3) && x.churn > churn);
    if (larger) {
      return verdict({
        action: 'hold',
        reason: `overlaps larger #${larger.p.number} on ${primary}`,
        comment: `Thanks. This is a focused change to \`${primary}\`, and it also overlaps #${larger.p.number}, which rewrites that file. Please rebase onto it after it merges, or say why this patch is independent and should land first. It will not be auto-merged while that larger pull request is open.`,
      }, linkedIssues);
    }
  }

  const where = areas.length ? areas.join(', ') : 'docs/tests';
  return verdict({
    action: 'merge',
    reason: `${changedFiles} file(s), ${churn} line(s) in ${where}${note}`,
    comment: '',
  }, linkedIssues);
}

/**
 * True when the latest review on this commit asks for changes.
 * An approval that comes after a request-changes review clears the block.
 * Reviews on older commits do not block a new head.
 * @param {Array<{state?:string, submittedAt?:string, commit?:{oid?:string}}>} reviews
 * @param {string} [headOid]
 */
export function mergeBlockedByReview(reviews = [], headOid = '') {
  const list = (reviews || []).filter(r => {
    const oid = r.commit?.oid || r.commitID || '';
    return !headOid || !oid || oid === headOid;
  });
  if (!list.length) return false;
  const latest = [...list].sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || ''))).at(-1);
  return String(latest?.state || '').toUpperCase() === 'CHANGES_REQUESTED';
}

/**
 * A later APPROVED review from someone other than the author lets a held PR merge.
 * Request-changes on the current commit still wins until a newer approval exists.
 * @param {{action:string}} verdict
 * @param {Array<{state?:string, submittedAt?:string, author?:{login?:string}, commit?:{oid?:string}}>} reviews
 * @param {string} headOid
 * @param {string} [authorLogin]
 */
export function maintainerApproved(verdict, reviews = [], headOid = '', authorLogin = '') {
  if (verdict.action === 'merge') return true;
  if (verdict.action !== 'hold') return false;
  if (mergeBlockedByReview(reviews, headOid)) return false;
  const list = (reviews || []).filter(r => {
    const oid = r.commit?.oid || '';
    return !headOid || !oid || oid === headOid;
  });
  const latest = [...list].sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || ''))).at(-1);
  const login = latest?.author?.login || '';
  return String(latest?.state || '').toUpperCase() === 'APPROVED' && !!login && login !== authorLogin;
}

/**
 * Review every open pull request from every contributor. Labels and author are
 * ignored. {@link assessUsefulness} decides close / request changes / hold / merge.
 * The `review` security gate is never bypassed. `--admin` is used only after that
 * gate is SUCCESS, and only to get past a stuck mechanical required check.
 *
 * A changes-requested review on the current commit blocks merge until a newer
 * approval. A hold can merge when a maintainer other than the author approves it.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] - assess + log intended actions, but perform no close/merge/update.
 * @returns {Promise<{merged:string[], closed:string[], skipped:string[], conflicts:string[], approvedCI?:string[], plan?:object[], reason?:string}>}
 */
export async function reviewAndMergePRs({ dryRun = false } = {}) {
  try {
    const info = await repoInfo();
    const target = info.upstream || info.origin;

    // Let external contributors' CI run so their security gate can pass. (Skipped on dry runs.)
    const approvedCI = dryRun ? [] : await approveForkCIRuns(target);

    const raw = await gh(
      'pr', 'list',
      '--repo', target,
      '--state', 'open',
      '--json', 'number,title,body,files,statusCheckRollup,url,additions,deletions,changedFiles,author,isCrossRepository,mergeable,mergeStateStatus,headRefOid,reviews,comments',
      '--limit', '50',
    );
    const prs = JSON.parse(raw || '[]');
    const merged = [], closed = [], skipped = [], conflicts = [], plan = [];

    for (const pr of prs) {
      const who = pr.author?.login ? `@${pr.author.login}` : 'unknown';
      const origin = pr.isCrossRepository ? 'fork' : 'branch';
      const tag = `#${pr.number} (${origin} by ${who})`;

      const issues = await linkedIssuesFor(target, pr).catch(() => []);
      const decision = assessUsefulness(pr, issues, prs);
      plan.push({ number: pr.number, url: pr.url, author: who, verdict: decision });

      if (decision.action === 'close') {
        if (dryRun) { closed.push(`${tag} — WOULD CLOSE (${decision.reason})`); continue; }
        try {
          await gh('pr', 'close', String(pr.number), '--repo', target, '--comment', decision.comment);
          closed.push(`${tag} — closed (${decision.reason})`);
        } catch { skipped.push(`${tag} — close failed`); }
        continue;
      }

      if (decision.action === 'request_changes' || decision.action === 'hold') {
        const head = pr.headRefOid || '';
        const notes = [...(pr.reviews || []), ...(pr.comments || [])];
        const already = notes.some(r => {
          const oid = r.commit?.oid || '';
          return /jobpilot-review/.test(r.body || '') && (!oid || !head || oid === head);
        });
        if (!dryRun && !already && decision.comment) {
          const body = `<!-- jobpilot-review -->\n${decision.comment}`;
          try {
            if (decision.action === 'request_changes') {
              await gh('pr', 'review', String(pr.number), '--repo', target, '--request-changes', '--body', body);
            } else {
              await gh('pr', 'comment', String(pr.number), '--repo', target, '--body', body);
            }
          } catch { /* comment failure must not merge the PR */ }
        }
        const approved = maintainerApproved(decision, pr.reviews || [], head, pr.author?.login || '');
        if (!approved) {
          skipped.push(`${tag} — ${decision.action}: ${decision.reason}`);
          continue;
        }
      }

      if (mergeBlockedByReview(pr.reviews || [], pr.headRefOid || '')) {
        skipped.push(`${tag} — changes requested on the current commit`);
        continue;
      }

      // The `review` CI job is the data-safety + security gate. It must have concluded SUCCESS.
      const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
      const reviewCheck = checks.find(c => (c.name || c.workflowName || '').toLowerCase().includes('review'));
      const reviewFailed = checks.some(c => {
        const n = (c.name || c.workflowName || '').toLowerCase();
        const concl = (c.conclusion || '').toUpperCase();
        return n.includes('review') && ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(concl);
      });
      const reviewPassed = reviewCheck
        ? (reviewCheck.conclusion || '').toUpperCase() === 'SUCCESS'
        : false;
      const noChecksYet = checks.length === 0;

      if (reviewFailed) {
        skipped.push(`${tag} — ${decision.reason}; review security gate is NOT green → not bypassed`);
        continue;
      }
      if (!reviewPassed) {
        skipped.push(`${tag} — ${decision.reason}; awaiting review gate${!noChecksYet ? ' (in progress)' : (approvedCI.length ? ' (CI approved, will run)' : '')}`);
        continue;
      }

      // ── From here the security gate is CONFIRMED GREEN. Only now may we merge. ──
      if (pr.mergeable === 'CONFLICTING') {
        conflicts.push(`${tag} — passed review, needs conflict resolution`);
        continue;
      }
      if (/BEHIND/i.test(pr.mergeStateStatus || '')) {
        if (dryRun) { skipped.push(`${tag} — WOULD update-branch then merge`); continue; }
        try { await gh('api', '--method', 'PUT', `repos/${target}/pulls/${pr.number}/update-branch`); } catch {}
      }

      if (dryRun) { merged.push(`${tag} — WOULD MERGE (${decision.reason})`); continue; }

      // --admin forces past a stuck mechanical check only after the security gate is SUCCESS.
      try {
        await gh('pr', 'merge', '--merge', '--admin', String(pr.number), '--repo', target);
        merged.push(`${tag} — merged (${decision.reason})`);
      } catch {
        try { await gh('pr', 'merge', '--merge', '--auto', String(pr.number), '--repo', target); merged.push(`${tag} — auto-merge armed (${decision.reason})`); }
        catch { skipped.push(`${tag} — merge blocked`); }
      }
    }

    if (merged.length && !dryRun) await syncBranch().catch(() => {});
    return { merged, closed, skipped, conflicts, approvedCI, plan };
  } catch (e) {
    return { merged: [], closed: [], skipped: [], conflicts: [], reason: e.message };
  }
}

// ── Blocker issue filing ──────────────────────────────────────────────────────

const BLOCKER_RULES = [
  { match: /indeed/i,                         title: "Blocker: Indeed anti-bot / login wall — can't auto-apply", labels: 'blocker', file: 'docs/issue-indeed.md' },
  { match: /glassdoor/i,                      title: "Blocker: Glassdoor login + anti-bot wall — can't auto-apply", labels: 'blocker', file: 'docs/issue-glassdoor.md' },
  { match: /workday|icims|taleo|successfactors|oraclecloud|brassring/i, title: 'Account-gated ATS adapters: Workday / iCIMS / Taleo / SuccessFactors', labels: 'ats-adapter', file: 'docs/issue-gated-ats.md' },
  { match: /arbeitnow|weworkremotely|himalayas|remoteok|lnkd\.in/i, title: 'Resolve job-board redirects to the real ATS (Arbeitnow, WeWorkRemotely, Himalayas, RemoteOK)', labels: 'ats-adapter', file: 'docs/issue-board-redirects.md' },
];

/**
 * File GitHub issues for recurring blockers discovered in the evolution memory.
 * Deduped by title — never files the same issue twice.
 * @param {object} opts
 * @param {number} [opts.minCount=3] - minimum encounter count before filing
 * @returns {Promise<{filed: string[], reason?}>}
 */
export async function fileBlockerIssues({ minCount = 3 } = {}) {
  let existing = [];
  try {
    existing = JSON.parse(
      await gh('issue', 'list', '--state', 'all', '--limit', '1000', '--json', 'title')
    ).map(i => i.title);
  } catch {
    return { filed: [], reason: 'gh not available / not authed' };
  }

  const enc  = openEncounters(60);
  const want = new Map();
  for (const e of enc) {
    if ((e.count || 0) < minCount) continue;
    const rule = BLOCKER_RULES.find(r => r.match.test(`${e.domain} ${e.signature}`));
    if (rule && !want.has(rule.title)) want.set(rule.title, rule);
  }

  const filed = [];
  for (const [title, rule] of want) {
    if (existing.includes(title)) continue;
    const bodyFile = path.join(ROOT, rule.file);
    const args = ['issue', 'create', '--title', title, '--label', rule.labels];
    if (fs.existsSync(bodyFile)) args.push('--body-file', bodyFile);
    else args.push('--body', 'Auto-filed from JobPilot evolution memory.');
    try { const url = await gh(...args); filed.push(url); } catch {}
  }
  return { filed };
}

// ── Main contribution round ───────────────────────────────────────────────────

/**
 * One full self-contribution cycle (the heart of self-evolution + recontribution):
 *   1. Pull the latest code from upstream (sync first — never contribute stale code)
 *   2. File GitHub issues for recurring blockers
 *   3. Open a CI-gated `self-evolve` PR for any local code/doc changes
 *        Fork → cross-fork PR to upstream.  Main → PR to its own main (never a direct push).
 *   4. Main repo only: review every open PR and merge the ones that pass the
 *      usefulness bar and the security gate.
 *
 * ON by default (profile.consent.autoContribute defaults true).
 * Toggle off from the dashboard. Pass force:true to override the consent flag.
 *
 * @param {string} [message] - commit/PR title
 * @param {object} [opts]
 * @param {boolean} [opts.force] - skip consent check
 * @returns {Promise<object>} { sync, issues, pr, review }
 */
export async function contributeRound(
  message = 'chore(self-evolve): sync improvements + file discovered blockers',
  { force = false } = {},
) {
  let enabled = force;
  if (!enabled) {
    try {
      const { getProfile } = await import('./profile.js');
      enabled = getProfile().consent?.autoContribute !== false;
    } catch {
      enabled = true;
    }
  }
  if (!enabled) return { skipped: true, reason: 'self-contribution is turned off in the dashboard' };

  // Contribution can be invoked by the worker or directly by the MCP/agent.
  // Make the latter safe too: audit and encounter reads must never depend on a
  // prior worker boot having initialized the shared sql.js handle.
  const { initDB } = await import('./tracker.js');
  await initDB();

  const info = await repoInfo();

  // 1. Always sync first — pull new version before contributing
  const sync = await syncBranch().catch(e => ({ synced: false, reason: e.message }));

  // Audit learning/improvement events alongside the normal blocker issue flow.
  // This is deliberately separate from the self-evolve PR label/workflow.
  const auditBefore = await syncEvolutionAuditIssues().catch(e => ({ created: [], reason: e.message }));

  // 2. File issues for recurring blockers
  const issues = await fileBlockerIssues().catch(e => ({ filed: [], reason: e.message }));

  // 3. Push local code/doc changes AS A PR (both fork and main repo).
  //    Every change must land on GitHub through a CI-gated self-evolve PR — never a direct push to
  //    main — so the security gate + boot smoke test always run first. For a fork this is a
  //    cross-fork PR to upstream; for the main repo it is a self-evolve PR to its own main.
  const pr = await contributeViaPR(message).catch(e => ({ pushed: false, reason: e.message }));
  const auditAfter = await syncEvolutionAuditIssues({ prUrl: pr.pr || '' }).catch(e => ({ created: [], reason: e.message }));

  // 4. Main repo ALSO acts as reviewer: merge every open self-evolve PR that has passed CI
  //    (including the one just opened, once its checks are green), then fast-forward main.
  let review = {};
  if (!info.isFork) {
    review = await reviewAndMergePRs().catch(e => ({ merged: [], skipped: [], reason: e.message }));
  }

  return { sync, issues, audits: { before: auditBefore, after: auditAfter }, pr, review };
}
