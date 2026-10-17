// Each group in preferences.mix totals 100. Missing keys use MIX_DEFAULT.

export const MIX_DEFAULT = {
  sources: { linkedin: 40, indeed: 20, glassdoor: 20, web: 20 },
  actions: { email: 34, posts: 16, connect: 16, dm: 12, easy_apply: 10, form: 12 },
};

const GROUPS = {
  sources: ['linkedin', 'indeed', 'glassdoor', 'web'],
  actions: ['email', 'posts', 'connect', 'dm', 'easy_apply', 'form'],
};

export function outreachMix(preferences = {}) {
  const saved = preferences.mix || {};
  const out = {};
  for (const [group, keys] of Object.entries(GROUPS)) {
    out[group] = {};
    for (const key of keys) {
      const n = Number(saved[group]?.[key]);
      out[group][key] = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : MIX_DEFAULT[group][key];
    }
  }
  return out;
}
