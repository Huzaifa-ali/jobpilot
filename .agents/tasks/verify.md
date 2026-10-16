# Verify — configurable apply/discovery channels

All commands run from the worktree root
`c:\Users\huzai\Downloads\personal-projects\jobpilot\.worktrees\channel-config` on Windows PowerShell.

## Summary

Implemented per plan. Three logical sources (`linkedin`, `indeed`, `glassdoor`) are now
configurable; default (no env, no profile knob) = all three, zero behavior change.

Files changed:
- **Create** `src/apply-sources.js` — pure `parseApplySources(input, profileVal)` + live `activeSources()`.
- **Create** `scripts/test-apply-sources.mjs` — pure-parser unit test.
- **Modify** `src/worker.js` — import resolver; gate applier `easy_apply`(linkedin)/`indeed_easy`(indeed);
  gate scout LI posts + LI jobs (linkedin) and Indeed PK discovery (indeed); boot log of active sources;
  Glassdoor-scout guard comment.
- **Modify** `package.json` — add `test:apply-sources` script.
- **No change** to `src/profile.js` or the `mcp-server.js` `set_profile` schema (verified they already
  persist `preferences.applySources` via the existing shallow-merge — see step 4).

Note on the task's suggested step-2 verify command: `parseApplySources` returns an object
`{ sources, emptyInput }` (as specified in the plan), so the iterable is `.sources`. The step-2
command below reads `.sources`; results match the expected sets exactly.

Note on Glassdoor: there is NO Glassdoor discovery/scrape step in the scout lane today (it is
external / board-pages routed only, `src/mcp/board-pages.js`). The `glassdoor` toggle is still
exposed in `activeSources()` so it is wired/testable, and a guard comment was added at the scout
Indeed region documenting that any future Glassdoor scout step must be gated behind
`active.has('glassdoor')`.

---

## 1. `node --check` on every changed file — PASS

```
node --check src/apply-sources.js
node --check src/worker.js
node --check scripts/test-apply-sources.mjs
```
Output: `EXIT=0` (all parse cleanly, no syntax errors).

## 2. Pure-parser inline test — PASS

```
node -e "import('./src/apply-sources.js').then(m=>{const a=m.parseApplySources; console.log(JSON.stringify([...a('indeed,glassdoor',null).sources]), JSON.stringify([...a('',null).sources]), JSON.stringify([...a(null,['linkedin']).sources]), JSON.stringify([...a('all',null).sources]), JSON.stringify([...a('bogus',null).sources]), 'bogusEmptyFlag='+a('bogus',null).emptyInput)})"
```
Output:
```
["indeed","glassdoor"] ["linkedin","indeed","glassdoor"] ["linkedin"] ["linkedin","indeed","glassdoor"] ["linkedin","indeed","glassdoor"] bogusEmptyFlag=true
```
Confirms:
- `indeed,glassdoor` → `{indeed,glassdoor}` ✓
- empty + null → all three ✓
- null + `['linkedin']` → `{linkedin}` ✓
- `all` → all three ✓
- `bogus` (parses empty) → all three fallback, with `emptyInput=true` so caller logs one note ✓

Unit test (`npm run test:apply-sources`) — all 13 cases **PASS**, exit 0:
```
PASS - both empty → all
PASS - empty string → all
PASS - empty array profile → all
PASS - env wins over profile
PASS - profile used when env absent
PASS - case-insensitive + spaces
PASS - all alias
PASS - star alias
PASS - all in array
PASS - unknown mixed ignored
PASS - all-unknown → all (never disable)
PASS - all-unknown → emptyInput flagged
PASS - array profile subset

ALL PASS
```

## 3. Time-boxed worker boot honoring a restricted set — PASS (no crash, no busy-spin)

```
$env:DRY='1'; $env:WORKER_DATA_ONLY='1'; $env:WORKER_NO_EVOLVE='1'; $env:RUN_MS='15000'; $env:JOBPILOT_APPLY_SOURCES='indeed'; node src/worker.js
```
(DATA_ONLY keeps the browser-outreach lanes off; `RUN_MS` self-terminates the worker; env cleared after.)

Output (filtered to scout + main):
```
main: worker start (DRY) (DATA-ONLY — agent handles outreach) — concurrent lanes: scout · refresher
main: active apply sources: indeed
scout: HN +0 (0 email)
scout: Boards +89 (0 email)
```
Confirms:
- Boot log shows exactly `active apply sources: indeed` ✓
- Scout did NOT run LinkedIn scraping — no `LI posts:` / `LI jobs:` line appeared (gated off) ✓
- HN + Boards (always-on web discovery) still ran ✓
- Process ran the lane briefly and exited cleanly at `RUN_MS`; no `uncaughtException`, no spin ✓

Resolver live-override check (reads env at call time, not cached):
```
$env:JOBPILOT_APPLY_SOURCES='indeed,glassdoor'; node -e "import('./src/apply-sources.js').then(m=>console.log([...m.activeSources()].join(',')))"
→ indeed,glassdoor
Remove-Item Env:JOBPILOT_APPLY_SOURCES; node -e "import('./src/apply-sources.js').then(m=>console.log([...m.activeSources()].join(',')))"
→ linkedin,indeed,glassdoor
```

The applier lane gating is static-verified: `wantEasy = liOn && …` and `wantIndeed = indeedOn && …`,
so with `JOBPILOT_APPLY_SOURCES=indeed` the `easy_apply` channel is never selected (linkedin off),
and `chan` falls through to `indeed_easy`/`form`. In DRY DATA-ONLY mode the applier lane itself does
not run (acting lanes off), so this path is exercised via the pure logic + unit tests rather than live
outreach, by design (no browser applies in verification).

## 4. Default (unset/empty) shows all three — PASS

```
Remove-Item Env:JOBPILOT_APPLY_SOURCES; $env:DRY='1'; $env:WORKER_DATA_ONLY='1'; $env:WORKER_NO_EVOLVE='1'; $env:RUN_MS='8000'; node src/worker.js
```
Output:
```
main: active apply sources: glassdoor, indeed, linkedin
```
Default = all three (sorted/stable), zero regression. ✓

## 4b. `set_profile` persists `preferences.applySources` (verify-only, no code change) — PASS

Ran the same code path `set_profile` uses (`updateProfile` → `getProfile`), capturing and restoring
the profile so no state is left mutated:
```
updateProfile({ preferences: { applySources: ['indeed','glassdoor'] } })
→ applySources= ["indeed","glassdoor"] rolesPreserved= true   (exit 0)
```
Confirms the new knob persists through the existing `preferences` shallow-merge and other preference
keys (`roles`) survive. **No change to `src/profile.js` or the `set_profile` schema was needed** —
`preferences` is a free-form object that already passes arbitrary keys through.

## 5. `node start.js` boots the MCP server — PASS

```
$env:JOBPILOT_NO_AUTOWORKER='1'; (Start-Process node start.js, sleep 6s, stop)
```
Process stayed alive (did not exit early / crash). stderr showed only the first-run dependency
bootstrap informational line. Stopped cleanly after the time-box. ✓

## 6. Security gate — PASS

Staged only the intended files, then:
```
git add src/apply-sources.js scripts/test-apply-sources.mjs src/worker.js package.json
node scripts/ci-security-scan.mjs
→ ✅ Security gate passed: no personal data, credentials, or out-of-allowlist paths.  (EXIT=0)
```

## Regression (existing tests, unchanged modules) — PASS
```
node scripts/test-exclusions.mjs   → ALL PASS (exit 0)   # profile.js untouched
node scripts/test-board-pages.mjs  → ok 19   (exit 0)    # board routing untouched
```

## git status (only intended files staged)
```
M  package.json
A  scripts/test-apply-sources.mjs
A  src/apply-sources.js
M  src/worker.js
```
No `data/`, `.env*`, `uploads/`, `*.db`, or `profile.json` staged.
