# Spec — Confident auto-answers, pluggable source registry, mandatory web search

Status: approved by user (2026-10-27). Build spec-driven + test-driven.

## Problem (root-caused, not guessed)

Three user-reported issues, each traced to a concrete cause in the code:

1. **Apply "gets stuck" and keeps retrying/skipping.** In `src/mcp/easyapply.js`,
   when the answer engine returns `null` for a *required* field, the field is added
   to `ctx.unanswered` and the apply returns `result:'needs_answers'`. The worker
   (`applier` lane, `src/worker.js`) marks the job `needs_manual`. Because the engine
   returns `null` for required radio/select/checkbox choices it can't map and for
   numeric fields with no profile value, genuinely answerable applications get parked
   and re-attempted (up to the 3-attempt cap) instead of submitted. This is the
   time-consuming skip/retry loop the user described.

2. **Only LinkedIn/Indeed/Glassdoor.** Platforms are hardcoded in two enums:
   `ALL_SOURCES` in `src/apply-sources.js` and `MIX_DEFAULT.sources` in `src/mix.js`.
   Adding a platform means editing multiple files. There is no web-search source.

3. **Web search not used.** Neither the code nor the brain's standing instructions
   force open-web discovery every cycle, so reach never expands past the hardcoded set.

## Decisions (made by the agent, per user direction "the agent must completely answer")

- **Confident answering, never stall.** The answer engine always returns a
  profile-grounded answer for every required field. Choice questions fall back to the
  safest profile-consistent option; numeric fields fall back to a sensible profile
  default (years of experience, 0, or notice period as appropriate); free-text already
  has a cover-text fallback. Legal/compliance questions (criminal history, sponsorship)
  keep their existing *standard-safe* defaults (no / profile-derived) rather than
  parking. Net: `needs_answers` for a required field becomes rare-to-never.

- **Source registry.** New `src/sources-registry.js` is the single source of truth for
  platforms. Each entry: `{ id, label, kind: 'apply'|'discovery'|'both', mixWeight,
  enabledByDefault }`. `apply-sources.js` and `mix.js` derive their lists from it.
  Adds `web_search` plus additional discovery platforms (wellfound, dice, remote boards,
  google_jobs) so `'indeed,facebook'`-style unknown tokens shrink over time as real
  platforms are registered.

- **Web search is first-class in two places (both, per user):**
  - *Code:* `web_search` is a registered discovery source with a non-zero mix weight,
    so a cycle always allocates effort to open-web discovery.
  - *AGENTS.md:* a hard standing instruction that every brain runs web search each cycle
    to discover jobs across the open web and keep expanding sources.

## Backward-compatibility constraints

- `parseApplySources` keeps its exact contract (env > profile > all; unknown-token
  behavior). Existing `scripts/test-apply-sources.mjs` must still pass, EXCEPT the one
  case asserting `facebook` is unknown — `facebook` is not being added as an apply
  source, so that case stays valid. New real sources added to the registry get new
  assertions.
- `outreachMix` keeps returning groups that total 100 with the same two groups
  (`sources`, `actions`). New source keys get default weights from the registry.
- No change to the DB schema, the worker lane structure, or the MCP tool list.

## Acceptance tests (TDD — write first, watch fail, then implement)

- `scripts/test-sources-registry.mjs`
  - registry exposes `web_search` with kind including discovery and a positive weight
  - `applySourceIds()` is a superset of the legacy `['linkedin','indeed','glassdoor']`
  - every registry source id is lowercase, unique, non-empty
  - `mixDefaults().sources` totals 100 and includes `web`/web_search weight > 0
- `scripts/test-answers-confidence.mjs` (pure, profile-injected)
  - a required yes/no capability question → non-null ("Yes")
  - a required single-choice with no profile match → returns a non-null safe option
  - a required numeric "how many years" with profile set → the profile number
  - a required numeric with no profile value → "0" (never null for a required numeric)
  - a legal screening ("have you been convicted") → safe standard answer, non-null
  - salary question → numeric, currency-aware (existing behavior preserved)
- `scripts/test-apply-sources.mjs` — unchanged cases still pass.

Integration check: `node src/doctor.js` still loads all modules without error, and
`node -e "import('./src/worker.js')"` imports clean (no runtime wiring broken).

## Out of scope

- No new browser drivers for the new discovery platforms in this change (web_search +
  the brain's own search cover open-web reach). Driver-level scraping for specific new
  boards can be added later behind their already-registered ids.
