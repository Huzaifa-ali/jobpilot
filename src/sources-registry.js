// src/sources-registry.js — the SINGLE source of truth for platforms JobPilot discovers
// and applies through. Platforms are DATA here, not hardcoded enums scattered across files.
//
// apply-sources.js derives its applyable board set from this registry; mix.js derives the
// default outreach mix "sources" group from it. Adding a new platform is a one-line entry
// here — no edits to the consumers. This is what lets the system "keep expanding" without a
// code change in every file.
//
// Each entry:
//   id              lowercase, unique, non-empty — the stable token used in profile/env config
//   label           human-readable name for dashboards/logs
//   kind            'apply'     → an action/apply channel (gated by apply-sources.js)
//                   'discovery' → a lead-discovery source only
//                   'both'      → gated for apply AND used for discovery
//   mixWeight       default weight in the outreach "sources" mix (0 = not in the mix)
//   mixKey          which MIX_DEFAULT.sources bucket this rolls up into (see note below)
//   enabledByDefault whether it is active when the user hasn't chosen an explicit set
//
// NOTE on mixKey: the dashboard sliders persist a fixed-shape mix (linkedin/indeed/glassdoor/
// web/x). Many discovery platforms (wellfound, dice, remote boards, google_jobs, hn, boards,
// web_search) are open-web sources, so they roll up into the shared `web` mix bucket. The
// registry keeps the finer-grained platform list; the mix keeps its stable five buckets.

export const SOURCES = [
  // ── Apply channels (drive a logged-in browser session) ──────────────────────
  { id: 'linkedin',   label: 'LinkedIn',   kind: 'both',      mixWeight: 32, mixKey: 'linkedin',  enabledByDefault: true },
  { id: 'indeed',     label: 'Indeed',     kind: 'both',      mixWeight: 16, mixKey: 'indeed',    enabledByDefault: true },
  { id: 'glassdoor',  label: 'Glassdoor',  kind: 'both',      mixWeight: 16, mixKey: 'glassdoor', enabledByDefault: true },

  // ── Discovery sources (feed the email/form/connect channels) ────────────────
  // web_search is the FIRST-CLASS open-web discovery source the user asked for: the brain
  // must run web search every cycle, and the code always allocates mix weight to it.
  { id: 'web_search', label: 'Web search', kind: 'discovery', mixWeight: 10, mixKey: 'web', enabledByDefault: true },
  { id: 'x',          label: 'X (Twitter)',kind: 'discovery', mixWeight: 20, mixKey: 'x',   enabledByDefault: true },
  { id: 'hn',         label: 'Hacker News',kind: 'discovery', mixWeight: 2,  mixKey: 'web', enabledByDefault: true },
  { id: 'boards',     label: 'Job boards', kind: 'discovery', mixWeight: 2,  mixKey: 'web', enabledByDefault: true },
  { id: 'wellfound',  label: 'Wellfound',  kind: 'discovery', mixWeight: 1,  mixKey: 'web', enabledByDefault: true },
  { id: 'dice',       label: 'Dice',       kind: 'discovery', mixWeight: 1,  mixKey: 'web', enabledByDefault: true },
  { id: 'remote',     label: 'Remote boards (WWR/RemoteOK)', kind: 'discovery', mixWeight: 0, mixKey: 'web', enabledByDefault: true },
  { id: 'google_jobs',label: 'Google Jobs',kind: 'discovery', mixWeight: 0,  mixKey: 'web', enabledByDefault: true },
];

/** Lookup one source by id (case-insensitive). */
export function sourceById(id) {
  const key = String(id || '').trim().toLowerCase();
  return SOURCES.find(s => s.id === key) || null;
}

/** Ids of sources that can be APPLY channels (kind 'apply' or 'both'). */
export function applySourceIds() {
  return SOURCES.filter(s => s.kind === 'apply' || s.kind === 'both').map(s => s.id);
}

/** Ids of sources usable for DISCOVERY (kind 'discovery' or 'both'). */
export function discoverySourceIds() {
  return SOURCES.filter(s => s.kind === 'discovery' || s.kind === 'both').map(s => s.id);
}

/** Ids enabled by default. */
export function defaultEnabledIds() {
  return SOURCES.filter(s => s.enabledByDefault).map(s => s.id);
}

// The two fixed mix groups. The `sources` group is derived from the registry (rolled up into
// the stable buckets via mixKey); the `actions` group is independent of platforms.
const ACTIONS_DEFAULT = { email: 34, posts: 16, connect: 16, dm: 12, easy_apply: 10, form: 12 };

/** Normalize a group so its weights total exactly 100 (largest-remainder style). */
function normalizeTo100(group) {
  const keys = Object.keys(group);
  if (!keys.length) return group;
  const sum = keys.reduce((s, k) => s + (group[k] || 0), 0);
  if (sum === 100) return group;
  if (sum <= 0) {
    const even = Math.floor(100 / keys.length);
    keys.forEach(k => { group[k] = even; });
    group[keys[keys.length - 1]] += 100 - even * keys.length;
    return group;
  }
  let rest = 100;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) group[k] = rest;
    else { const n = Math.max(0, Math.min(rest, Math.round(group[k] / sum * 100))); group[k] = n; rest -= n; }
  });
  return group;
}

/**
 * Default outreach mix derived from the registry. The `sources` group keeps the stable five
 * dashboard buckets (linkedin/indeed/glassdoor/web/x); every registry source rolls into its
 * mixKey bucket by summing mixWeight. Always normalized to total 100 per group.
 * @returns {{ sources: Record<string,number>, actions: Record<string,number> }}
 */
export function mixDefaults() {
  const buckets = { linkedin: 0, indeed: 0, glassdoor: 0, web: 0, x: 0 };
  for (const s of SOURCES) {
    const key = buckets[s.mixKey] != null ? s.mixKey : 'web';
    buckets[key] += s.mixWeight || 0;
  }
  return {
    sources: normalizeTo100({ ...buckets }),
    actions: normalizeTo100({ ...ACTIONS_DEFAULT }),
  };
}
