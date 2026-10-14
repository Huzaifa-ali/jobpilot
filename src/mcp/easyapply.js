// src/mcp/easyapply.js — LinkedIn Easy Apply driver (2026 UI: native <dialog>, obfuscated classes).
// Self-evolving:
//   • HARVESTS every prefilled answer LinkedIn shows (= your past answers) into evolution memory
//   • unknown required questions → "questions for you" (asked once, reused forever)
//   • anything unexpected → an encounter with a DOM snapshot for the coding agent to fix
//   • success is VERIFIED by reloading the job and reading "Application submitted"
import { getContext } from '../agent/browser.js';
import { getProfile } from '../profile.js';
import { textAnswer, choiceAnswer, salaryFor } from './answers.js';
import { learn, askLater, encounter } from '../evolve.js';
import fs from 'fs';
import { cvAttachmentForJob } from '../cv.js';

const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const APPLIED_RE = /Application submitted|Applied \d+ (second|minute|hour|day)s? ago|You applied|application was sent/i;

// In-page: tag every field in the dialog and describe it.
const SCAN = (dlg) => {
  const qOf = (el) => {
    const root = el.getRootNode();
    if (el.type !== 'radio' && el.type !== 'checkbox' && el.id) {
      const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.innerText.trim()) return l.innerText;
    }
    const fs = el.closest('fieldset'); const lg = fs?.querySelector('legend'); if (lg?.innerText.trim()) return lg.innerText;
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.type === 'radio' || el.type === 'checkbox') {
      // walk up past the options block to the first line that is real question text
      let p = el.parentElement;
      for (let i = 0; i < 10 && p && p !== dlg; i++, p = p.parentElement) {
        const line = (p.innerText || '').split('\n').map(s => s.trim()).find(s => s.length > 8 && !/^(yes|no)$/i.test(s));
        if (line && p.querySelectorAll('input[type="radio"], input[type="checkbox"]').length < 12) return line;
      }
    }
    let p = el.parentElement;
    for (let i = 0; i < 8 && p && p !== dlg; i++, p = p.parentElement) {
      const t = (p.innerText || '').trim();
      if (t.length > 3 && t.length < 600 && (/[?*]/.test(t) || p.querySelectorAll('input,select,textarea').length > 1)) return t.split('\n').find(s => s.trim().length > 3) || t;
    }
    return el.placeholder || el.name || '';
  };
  const out = []; let i = 0; const nonce = Math.random().toString(36).slice(2, 7);
  for (const el of dlg.querySelectorAll('input, select, textarea')) {
    if (el.type === 'hidden' || el.disabled) continue;
    const id = 'ja' + nonce + (i++); el.setAttribute('data-ja', id);
    const root = el.getRootNode();
    const lbl = el.id ? root.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const q = (qOf(el) || '').replace(/\s+/g, ' ').trim();
    out.push({
      id, tag: el.tagName, type: el.type, name: el.name, role: el.getAttribute('role') || '',
      q: q.replace(/\s*\*\s*$/, '').slice(0, 300),
      elId: el.id,
      optLabel: ((el.closest('[role="radio"]')?.innerText || '').trim() || lbl?.innerText.trim() || el.closest('label')?.innerText.trim() || (el.value && el.value !== 'on' ? el.value : '') || el.closest('[role="radio"]')?.getAttribute('aria-label') || '').trim().split('\n')[0],
      val: el.tagName === 'SELECT' ? (el.selectedIndex > 0 ? el.options[el.selectedIndex].text : '') : (el.value || ''),
      checked: !!el.checked,
      opts: el.tagName === 'SELECT' ? [...el.options].map(o => o.text.trim()) : undefined,
      required: el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(q),
      numeric: el.type === 'number' || /numeric/i.test(el.id) || el.getAttribute('inputmode') === 'numeric',
      maxlength: (() => { const m = parseInt(el.getAttribute('maxlength')); return Number.isFinite(m) && m > 0 ? m : 0; })(),
      // Stable group handle for name-less radio/checkbox groups: the index of the enclosing
      // fieldset/group within the dialog. Lets us group bare checkboxes that share a container.
      grpIdx: (() => {
        if (el.type !== 'radio' && el.type !== 'checkbox') return -1;
        const fsAnc = el.closest('fieldset, [role="group"], [role="radiogroup"]');
        if (!fsAnc) return -1;
        const all = [...dlg.querySelectorAll('fieldset, [role="group"], [role="radiogroup"]')];
        return all.indexOf(fsAnc);
      })(),
    });
  }
  // For radio groups whose option labels are not on the inputs (2026 LinkedIn), capture the
  // ordered list of visible option texts that follow each question heading, so multi-option
  // radios (e.g. English: Native/Fluent, Advanced, …) can be matched by position.
  const radioGroupOptions = {};
  // Per-fieldset metadata keyed by group index — for BARE radio/checkbox groups with no
  // name/aria-label/label (e.g. the timezone multi-select). Derive the question from the
  // nearest heading before the fieldset, and options from the fieldset's text lines.
  const groupByIdx = {};
  try {
    const allGroups0 = [...dlg.querySelectorAll('fieldset, [role="group"], [role="radiogroup"]')];
    allGroups0.forEach((fsEl, gi) => {
      const inputs = fsEl.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (inputs.length < 2) return;
      let question = (inputs[0].getAttribute('aria-label') || fsEl.querySelector('legend')?.innerText || '').replace(/\s+/g, ' ').trim();
      if (!question) {
        let prev = fsEl.previousElementSibling, hops = 0;
        while (prev && hops < 4 && !question) { const t = (prev.innerText || '').trim(); if (t && t.length < 160 && /\?|time ?zone|which|select|country|language|able to work/i.test(t)) question = t.split('\n').pop().trim(); prev = prev.previousElementSibling; hops++; }
      }
      const qn = question.toLowerCase().replace(/\*+$/, '').trim();
      const lines = (fsEl.innerText || '').split('\n').map(s => s.trim()).filter(s => s && s.length < 40 && s.toLowerCase().replace(/\*+$/, '').trim() !== qn);
      groupByIdx[gi] = { question: question.slice(0, 120), options: [...new Set(lines)].slice(0, inputs.length), isCheckbox: inputs[0].type === 'checkbox' };
    });
    for (const fsEl of dlg.querySelectorAll('fieldset, [role="group"], [role="radiogroup"]')) {
      const inputs = fsEl.querySelectorAll('input[type="radio"]');
      if (inputs.length < 2) continue;
      const q = (inputs[0].getAttribute('aria-label') || fsEl.querySelector('legend')?.innerText || '').replace(/\s+/g, ' ').trim();
      if (!q) continue;
      // Option texts: 2026 LinkedIn renders them as bare text nodes/lines inside the fieldset
      // (not in <label>/<span> with innerText). Parse the fieldset's innerText into lines,
      // drop the question line and empties, and keep the first N lines = the ordered options.
      const qNorm = q.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\*+$/, '').trim();
      const lines = (fsEl.innerText || '').split('\n').map(s => s.trim())
        .filter(s => s && s.length < 40 && s.replace(/\*+$/, '').trim().toLowerCase() !== qNorm);
      // also try explicit label/span texts as a fallback source
      const nodeTexts = [...fsEl.querySelectorAll('label, span')].map(e => (e.innerText || '').trim()).filter(t => t && t.length < 40 && t.toLowerCase() !== qNorm);
      const uniq = [...new Set([...lines, ...nodeTexts])];
      if (uniq.length >= inputs.length) radioGroupOptions[q.slice(0, 120)] = uniq.slice(0, inputs.length);
    }
  } catch {}
  const errors = [...dlg.querySelectorAll('[role="alert"], [aria-live], .artdeco-inline-feedback--error')]
    .map(e => e.innerText.trim()).filter(t => t && /required|valid|enter|select|must|between|larger|smaller|whole number|decimal/i.test(t));
  const text = dlg.innerText.replace(/\s+/g, ' ');
  // LinkedIn alternates between "1/6 pages", "16%", and
  // "16 percent complete". Keep all forms so a validation-blocked page is
  // recognized as unchanged and its missing required fields can be surfaced.
  return { fields: out, errors, radioGroupOptions, groupByIdx, progress: (text.match(/(\d+)\/(\d+) pages|(\d+)%|(\d+)\s+percent\s+complete/i) || [''])[0], heading: (dlg.querySelector('h3, h2')?.innerText || '').trim(), text: text.slice(0, 300) };
};

const IDENTITY = /^(email|phone|mobile|first name|last name|city|location|country code|phone country code)/i;

// OPTIONAL consent / marketing / follow checkboxes. These are never truly required to submit a
// LinkedIn Easy Apply, so they must NEVER be parked as "needs your answer" (that was the main
// cause of "opens Easy Apply but never submits" — one optional marketing opt-in blocked the whole
// application). We simply leave them unchecked and move on.
const OPTIONAL_CONSENT = /allow(ing)?\b.*\bcontact|contact me about|marketing|promotional|newsletter|future (job )?opportunities|future roles|future positions|keep me (informed|updated)|stay in touch|follow (the )?company|receive (updates|communications|emails)|opt[- ]?in|subscribe|share my (profile|data|information)|talent (community|network|pool)|join .* talent/i;
const isOptionalConsent = q => OPTIONAL_CONSENT.test(String(q || ''));

// Look up the AGENT's reasoned answer for a question (fuzzy, case-insensitive). Returns the
// answer string/array if the agent provided one for this field, else undefined so the caller
// falls back to the built-in engine. This is what lets the agent reason over any form.
function agentAnswerFor(ctx, question) {
  const map = ctx && ctx.agentAnswers;
  if (!map || !question) return undefined;
  const q = String(question).toLowerCase().replace(/\s+/g, ' ').replace(/\*+$/, '').trim();
  if (map[question] != null) return map[question];
  // exact-normalized
  for (const [k, v] of Object.entries(map)) {
    if (String(k).toLowerCase().replace(/\s+/g, ' ').replace(/\*+$/, '').trim() === q) return v;
  }
  // containment either direction (handles truncated question text)
  for (const [k, v] of Object.entries(map)) {
    const kk = String(k).toLowerCase().replace(/\s+/g, ' ').trim();
    if (kk.length > 10 && (q.includes(kk) || kk.includes(q))) return v;
  }
  return undefined;
}

async function fillPage(page, dlg, ctx, job = {}) {
  const { fields, radioGroupOptions = {}, groupByIdx = {} } = await dlg.evaluate(SCAN);
  const p = getProfile();
  const cvPath = cvAttachmentForJob(job, p);
  const groups = {};
  for (const f of fields) if (f.type === 'radio') (groups[f.name || f.q] ||= []).push(f);
  // Checkbox GROUPS: LinkedIn renders "select all that apply" questions as role="checkbox"
  // wrappers around hidden inputs. Group by the shared `name` (like radios) — keying by the
  // per-input label wrongly split them (each option like "Australia" became its own 1-item
  // group that then got skipped). The real question lives in aria-label / radioGroupOptions.
  // Group checkboxes by: shared name → else shared fieldset index (grpIdx) → else the question.
  // Bare 2026 checkboxes have no name/label, so grpIdx (the enclosing fieldset) is what ties
  // the timezone-style multi-selects together.
  const cbGroups = {};
  for (const f of fields) if (f.type === 'checkbox') {
    const key = f.name || (f.grpIdx >= 0 ? `grp${f.grpIdx}` : f.q);
    (cbGroups[key] ||= []).push(f);
  }
  // A real multi-option question = 2+ checkboxes sharing one group. Standalone checkboxes
  // (single consent/privacy/terms boxes) are still handled inline in the per-field loop.
  const groupedCbIds = new Set();
  for (const [, g] of Object.entries(cbGroups)) if (g.length >= 2) g.forEach(f => groupedCbIds.add(f.id));

  for (const f of fields) {
    const loc = page.locator(`[data-ja="${f.id}"]`);
    try {
      if (f.type === 'file') {
        if (cvPath && fs.existsSync(cvPath) && /resume|cv/i.test(f.q) && !fields.some(x => x.type === 'radio' && x.checked && /resume/i.test(x.q))) await loc.setInputFiles(cvPath).catch(() => {});
        continue;
      }
      if (f.type === 'radio') continue;
      if (f.type === 'checkbox') {
        if (groupedCbIds.has(f.id)) continue; // part of a multi-option question → handled below
        // Optional consent/marketing/follow boxes: never auto-check, uncheck if preselected,
        // and never treat as blocking. These are the ones that used to stall the whole apply.
        if (isOptionalConsent(f.q) || isOptionalConsent(f.optLabel)) { if (f.checked) await loc.uncheck({ force: true }).catch(() => {}); continue; }
        if (!f.checked && f.required) await loc.check({ force: true }).catch(() => {});
        if (f.checked && /follow/i.test(f.q + f.optLabel)) await loc.uncheck({ force: true }).catch(() => {});
        continue;
      }
      if (f.tag === 'SELECT') {
        if (f.val && !/select an option/i.test(f.val)) { if (!IDENTITY.test(f.q)) learn(f.q, f.val, 'harvested'); continue; }
        const agentSel = agentAnswerFor(ctx, f.q);
        const opts = f.opts.slice(1);
        // Agent answer: match it to the closest option label.
        let pick = null;
        if (agentSel !== undefined) {
          const a = String(Array.isArray(agentSel) ? agentSel[0] : agentSel).toLowerCase();
          pick = opts.find(o => o.toLowerCase() === a) || opts.find(o => o.toLowerCase().includes(a) || a.includes(o.toLowerCase())) || null;
        }
        if (!pick) pick = choiceAnswer(f.q, opts);
        if (pick) await loc.selectOption({ label: pick }).catch(() => {});
        else if (f.required && !isOptionalConsent(f.q)) { ctx.unanswered.add(f.q); askLater(f.q, opts); }
        continue;
      }
      if (f.val && f.val.trim()) { if (!IDENTITY.test(f.q) && f.q.length > 8) learn(f.q, f.val.trim(), 'harvested'); continue; }
      // Salary/compensation fields: LinkedIn renders them type=text but silently rejects
      // non-numeric input (e.g. "Negotiable"), which blocks "Review" with no visible error.
      // Force a numeric answer for anything salary-shaped so the page can advance.
      const isSalary = /salary|compensation|\bctc\b|expected pay|pay expectation|remuneration|\brate\b|were you making/i.test(f.q);
      const numeric = f.numeric || isSalary || /how many|years|number of/i.test(f.q);
      // AGENT answer wins: if the agent reasoned an answer for this question, use it verbatim.
      const agentV = agentAnswerFor(ctx, f.q);
      let v = agentV !== undefined ? (Array.isArray(agentV) ? agentV.join(', ') : String(agentV)) : textAnswer(f.q, { numeric });
      // Country-of-residence questions: answer with the profile's country.
      if ((v == null || v === '') && /which country.*(reside|live|based)|country.*(you.*(reside|live)|of residence)|where.*(do you )?(reside|live)/i.test(f.q)) {
        v = p.country || (p.location || '').split(',').pop()?.trim() || 'Pakistan';
      }
      // Salary fields: LinkedIn renders them type=text but silently rejects non-numeric input
      // (e.g. "Negotiable"), blocking Review with no error. Force clean numeric digits, and
      // convert to USD when the field explicitly asks for USD.
      if (isSalary && (v == null || isNaN(parseFloat(String(v).replace(/[,\s]/g, ''))))) {
        const wantUsd = /\busd\b|us ?dollar|\$/i.test(f.q);
        const sal = salaryFor(wantUsd ? f.q + ' usd' : f.q, getProfile(), true);
        v = sal != null ? String(sal).replace(/[^\d]/g, '') : v;
      }
      if (v == null || v === '') { if (f.required && !isOptionalConsent(f.q)) { ctx.unanswered.add(f.q); askLater(f.q); } continue; }
      // Respect the field's maxlength so a long cover-style answer isn't silently rejected
      // (e.g. a 20-char "experience" field). Truncate cleanly to fit.
      let fillVal = String(v);
      if (f.maxlength && fillVal.length > f.maxlength) {
        // For tiny limits a yes/short token is better than a truncated sentence.
        fillVal = f.maxlength <= 10 ? (/\byes\b/i.test(fillVal) ? 'Yes' : fillVal.slice(0, f.maxlength)) : fillVal.slice(0, f.maxlength);
      }
      await loc.fill(fillVal);
      ctx.used.push(f.q);
      if (f.role === 'combobox' || /city|location/i.test(f.q)) {
        await SLEEP(1200);
        const opt = page.locator('[role="listbox"] [role="option"]').first();
        if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => {});
        else await loc.press('ArrowDown').then(() => loc.press('Enter')).catch(() => {});
      }
    } catch {}
  }
  for (const g of Object.values(groups)) {
    // resume picker (radio-group of CV files) — LinkedIn preselects the latest; leave it
    if (/^radio-group|resume|cv/i.test(g[0].q) || g.every(r => /\.(pdf|docx?)$/i.test(r.optLabel))) continue;
    const learnable = g[0].q.length > 8 && !/^radio-group/.test(g[0].q);
    const checked = g.find(r => r.checked);
    if (checked) { if (learnable && checked.optLabel) learn(g[0].q, checked.optLabel, 'harvested'); continue; }
    // 2026 LinkedIn renders screening radios as raw <input type=radio> with EMPTY labels and
    // no role=radio wrapper — every input shares the QUESTION as aria-label and the visible
    // option text lives in sibling spans/labels. Resolve option labels by ORDER:
    //   • prefer the ordered option-text list captured from the group (radioGroupOptions),
    //   • else for a 2-option group assume LinkedIn's Yes/No convention,
    //   • else fall back to whatever optLabels we have.
    const rawLabels = g.map(r => (r.optLabel || '').trim());
    const allEmpty = rawLabels.every(l => !l);
    const captured = radioGroupOptions[(g[0].q || '').slice(0, 120)];
    let effLabels;
    if (allEmpty && Array.isArray(captured) && captured.length === g.length) effLabels = captured;
    else if (allEmpty && g.length === 2) effLabels = ['Yes', 'No'];
    else effLabels = rawLabels;

    // AGENT answer wins: match the agent's reasoned choice to one of the options.
    let pick = null;
    const agentR = agentAnswerFor(ctx, g[0].q);
    if (agentR !== undefined) {
      const a = String(Array.isArray(agentR) ? agentR[0] : agentR).toLowerCase().trim();
      pick = effLabels.find(l => l.toLowerCase() === a) || effLabels.find(l => l.toLowerCase().includes(a) || a.includes(l.toLowerCase())) || null;
      // yes/no shorthand
      if (!pick && /^y/.test(a)) pick = effLabels.find(l => /^yes/i.test(l));
      if (!pick && /^n/.test(a)) pick = effLabels.find(l => /^no/i.test(l));
    }
    if (!pick) pick = choiceAnswer(g[0].q, effLabels);
    if (process.env.DEBUG_EA) console.log('RADIO', JSON.stringify({ q: g[0].q, raw: rawLabels, eff: effLabels, agent: agentR, pick }));
    if (!pick) {
      if (isOptionalConsent(g[0].q)) continue; // optional consent radio → don't block
      ctx.unanswered.add(g[0].q); if (learnable) askLater(g[0].q, effLabels); continue;
    }
    // Map the picked label to the specific input in the group.
    const pickIdx = effLabels.findIndex(l => l.toLowerCase() === pick.toLowerCase());
    const targetField = pickIdx >= 0 ? g[pickIdx] : g.find(x => (x.optLabel || '').toLowerCase() === pick.toLowerCase()) || g[0];
    const loc = page.locator(`[data-ja="${targetField.id}"]`);
    let okRadio = false;
    // The <input> is 0×0 (unclickable) and its React id is ephemeral; resolve the real
    // clickable <label for=id> from the STABLE data-ja input inside one evaluate, click it,
    // force the input checked, and fire change/input so LinkedIn's form state advances.
    okRadio = await loc.evaluate(el => {
      const root = el.getRootNode();
      const lbl = el.id ? root.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      if (lbl) { try { lbl.click(); } catch {} }
      if (!el.checked) { el.checked = true; try { el.click(); } catch {} }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return !!el.checked;
    }).catch(() => false);
    // Fallback: role=radio wrapper (older UI).
    if (!okRadio) {
      const wrap = dlg.getByRole('radio', { name: g[0].q, exact: false }).filter({ hasText: new RegExp(`^\\s*${pick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') }).first();
      if (await wrap.count().catch(() => 0)) { await wrap.click({ timeout: 2500 }).catch(() => {}); okRadio = await wrap.getAttribute('aria-checked').then(v => v === 'true').catch(() => false); }
    }
    if (process.env.DEBUG_EA) console.log('  radio checked:', okRadio, 'pickIdx', pickIdx);
    if (okRadio) ctx.used.push(g[0].q);
    else if (!isOptionalConsent(g[0].q)) { ctx.unanswered.add(g[0].q); if (learnable) askLater(g[0].q, effLabels); }
  }

  // Checkbox GROUPS (multi-option "select all that apply" / single-select questions).
  for (const [, g] of Object.entries(cbGroups)) {
    if (g.length < 2) continue;                              // standalone consent handled inline
    if (g.some(c => c.checked)) continue;                    // user already selected something
    // Real question + option labels. For bare 2026 checkboxes the inputs carry no label/name,
    // so pull the question + ordered options from the per-fieldset metadata (groupByIdx).
    const gm = g[0].grpIdx >= 0 ? groupByIdx[g[0].grpIdx] : null;
    const question = ((gm && gm.question) || g[0].q || q || '').trim();
    const rawLabels = g.map(c => (c.optLabel || '').trim());
    const captured = (gm && gm.options && gm.options.length === g.length ? gm.options : null) || radioGroupOptions[(question).slice(0, 120)];
    const labels = rawLabels.every(l => !l)
      ? (Array.isArray(captured) && captured.length === g.length ? captured : rawLabels)
      : rawLabels;

    // Decide which option(s) to check: agent answer → profile match → smart default.
    let picks = [];
    const agentC = agentAnswerFor(ctx, question);
    if (agentC !== undefined) {
      const wanted = (Array.isArray(agentC) ? agentC : String(agentC).split(/[,/]/)).map(s => s.toLowerCase().trim()).filter(Boolean);
      picks = labels.filter(l => wanted.some(w => l.toLowerCase() === w || l.toLowerCase().includes(w) || w.includes(l.toLowerCase())));
    }
    if (!picks.length) { const choice = choiceAnswer(question, labels.filter(Boolean)); if (choice) picks = [choice]; }
    // Timezone / "which of the following ... able to work in" style: the user can work ANY
    // timezone, so pick US (preferred) or the first option rather than skipping a required group.
    if (!picks.length && /time ?zone|able to work in|which of the following|regions?|markets?/i.test(question)) {
      picks = [labels.find(l => /\bus\b|united states|u\.s\.|est|et\b|pst/i.test(l)) || labels.find(Boolean)].filter(Boolean);
    }
    // Last resort for any other required multi-select: a neutral option, else the first.
    if (!picks.length && g[0].required) {
      picks = [labels.find(l => /^(other|none|n\/?a|prefer not)/i.test(l)) || labels.find(Boolean)].filter(Boolean);
    }
    if (process.env.DEBUG_EA) console.log('CBGROUP', JSON.stringify({ q: question, opts: labels, agent: agentC, picks }));
    if (!picks.length) { if (g[0].required && !isOptionalConsent(question)) { ctx.unanswered.add(question); askLater(question, labels.filter(Boolean)); } continue; }

    let anyChecked = false;
    for (const pick of picks) {
      const idx = labels.findIndex(l => l.toLowerCase() === String(pick).toLowerCase());
      const target = idx >= 0 ? g[idx] : (g.find(x => (x.optLabel || '').toLowerCase() === String(pick).toLowerCase()) || g[0]);
      const loc = page.locator(`[data-ja="${target.id}"]`);
      // Same robust path as radios: click the <label for=id>, force-check, fire events.
      const ok = await loc.evaluate(el => {
        const root = el.getRootNode();
        const lbl = el.id ? root.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
        if (lbl) { try { lbl.click(); } catch {} }
        if (!el.checked) { el.checked = true; try { el.click(); } catch {} }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return !!el.checked;
      }).catch(() => false);
      if (!ok) {
        const wrap = dlg.locator('[role="checkbox"]').filter({ hasText: new RegExp(`^\\s*${String(pick).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') }).first();
        if (await wrap.count().catch(() => 0)) { await wrap.click({ timeout: 2500 }).catch(() => {}); }
      }
      anyChecked = anyChecked || ok;
    }
    if (anyChecked) ctx.used.push(question);
    else if (g[0].required && !isOptionalConsent(question)) { ctx.unanswered.add(question); askLater(question, labels.filter(Boolean)); }
  }
}

// ── REASONING / ANALYSIS STEP ─────────────────────────────────────────────────
// Every LinkedIn Easy Apply form is different, so before (and after) filling we ANALYZE the
// whole page: classify each field, decide the intended answer + why, and flag which required
// fields are still unresolved. This produces a transparent plan the fill step and the
// evolution memory can both use, instead of blind field-by-field pattern matching.
async function analyzePage(dlg) {
  const { fields, radioGroupOptions = {}, heading, errors = [] } = await dlg.evaluate(SCAN);
  const p = getProfile();
  const plan = [];
  // group radios/checkboxes by question so the analysis reflects real questions, not inputs
  const radioByGroup = {}; for (const f of fields) if (f.type === 'radio') (radioByGroup[f.name || f.q] ||= []).push(f);
  const seenRadio = new Set();

  for (const f of fields) {
    if (f.type === 'hidden') continue;
    const q = f.q || f.optLabel || f.name;
    let decision = null, reason = '', kind = f.type;

    if (f.type === 'file') { decision = 'attach CV'; reason = 'resume upload'; }
    else if (f.type === 'radio') {
      const key = f.name || f.q; if (seenRadio.has(key)) continue; seenRadio.add(key);
      const g = radioByGroup[key] || [f];
      kind = `radio(${g.length})`;
      const raw = g.map(r => (r.optLabel || '').trim());
      const captured = radioGroupOptions[(g[0].q || '').slice(0, 120)];
      const opts = raw.every(l => !l) ? (Array.isArray(captured) && captured.length === g.length ? captured : (g.length === 2 ? ['Yes', 'No'] : raw)) : raw;
      const pick = choiceAnswer(g[0].q, opts);
      decision = pick; reason = pick ? `matched option "${pick}" of [${opts.join(', ')}]` : (isOptionalConsent(g[0].q) ? 'optional consent — skip' : `NO MATCH in [${opts.join(', ')}]`);
    }
    else if (f.tag === 'SELECT') { const pick = choiceAnswer(f.q, (f.opts || []).slice(1)); decision = pick; reason = pick ? `select "${pick}"` : 'no select match'; }
    else if (f.type === 'checkbox') { decision = isOptionalConsent(f.q) ? 'leave unchecked (consent)' : (f.required ? 'check (required)' : 'skip'); reason = 'checkbox'; }
    else { // text / textarea / tel
      const isSalary = /salary|compensation|\bctc\b|were you making|desired (pay|salary)|current (pay|salary)/i.test(q);
      const numeric = f.numeric || isSalary || /how many|years|number of/i.test(q);
      let v = textAnswer(q, { numeric });
      if ((v == null || v === '') && /which country.*(reside|live|based)|country of residence/i.test(q)) v = p.country || 'Pakistan';
      decision = v; reason = v != null ? 'answered from profile/rules' + (f.maxlength ? ` (max ${f.maxlength})` : '') : (isOptionalConsent(q) ? 'optional — skip' : 'UNRESOLVED');
    }
    const resolved = decision != null && decision !== '' || /skip|optional/i.test(reason);
    plan.push({ q: String(q).slice(0, 70), kind, required: !!f.required, decision: decision == null ? null : String(decision).slice(0, 50), reason, resolved });
  }

  const blocking = plan.filter(x => x.required && !x.resolved);
  if (process.env.DEBUG_EA) {
    console.log(`\n[ANALYZE] "${heading}" — ${plan.length} fields, ${blocking.length} blocking${errors.length ? ', errors: ' + errors.join(' | ') : ''}`);
    for (const x of plan) console.log(`  ${x.resolved ? '✓' : '✗'} [${x.kind}${x.required ? '*' : ''}] ${x.q} => ${x.decision ?? '—'} (${x.reason})`);
  }
  return { heading, plan, blocking, errors };
}

async function discard(page) {
  await page.locator('dialog').getByRole('button', { name: /dismiss|close/i }).first().click({ timeout: 3000 }).catch(() => {});
  await SLEEP(800);
  await page.getByRole('button', { name: /discard/i }).first().click({ timeout: 3000 }).catch(() => {});
}

async function verifyApplied(page, url) {
  const body = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (APPLIED_RE.test(body)) return true;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await SLEEP(3000);
  const main = await page.evaluate(() => (document.querySelector('main') || document.body).innerText.slice(0, 2500)).catch(() => '');
  return APPLIED_RE.test(main);
}

/**
 * Apply via Easy Apply. Returns {ok, result, detail, questions?, meta, externalUrl?}
 * result: applied | already_applied | no_easy_apply | needs_answers | stuck | closed | error | dry_run_ready
 */
export async function easyApply({ url, timeoutMs = 120000, dryRun = false, job = {} }) {
  const bctx = await getContext();
  const page = await bctx.newPage();
  page.setDefaultTimeout(15000);
  const t0 = Date.now();
  const ctx = { unanswered: new Set(), used: [] };
  let meta = {};
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await SLEEP(3000);
    meta = await page.evaluate(() => {
      const main = (document.querySelector('main') || document.body).innerText;
      return { posted: (main.match(/(\d+\s+(minute|hour|day|week|month)s?\s+ago)/) || [])[1] || '', head: main.slice(0, 1500) };
    });
    // LinkedIn daily submission cap: "We limit daily submissions ... Save this job and apply tomorrow."
    if (/limit daily submissions|apply tomorrow|reached your daily|daily (submission|application) limit|limit.{0,30}submissions/i.test(meta.head)) {
      await encounter('easy_apply', 'linkedin daily submission limit reached', { url, page });
      await page.close(); return { ok: false, result: 'daily_limit', detail: 'LinkedIn daily Easy Apply limit reached — pausing Easy Apply until tomorrow', meta };
    }
    // LinkedIn anti-bot throttle: a security checkpoint / "unusual activity" / rate-limit page.
    if (/security check|security verification|unusual activity|doing that too (much|often|fast)|try again later|rate limit|you.?ve reached|temporarily (restricted|blocked)|verify you.?re a human|captcha|\/checkpoint\//i.test(meta.head + ' ' + page.url())) {
      await encounter('easy_apply', 'linkedin anti-bot throttle / checkpoint', { url, page });
      await page.close(); return { ok: false, result: 'throttled', detail: 'LinkedIn security check / rate limit — backing off', meta };
    }
    if (APPLIED_RE.test(meta.head)) { await page.close(); return { ok: true, result: 'already_applied', detail: 'LinkedIn shows already applied', meta }; }
    if (/no longer accepting applications/i.test(meta.head)) { await page.close(); return { ok: true, result: 'closed', detail: 'no longer accepting applications', meta }; }

    const ea = page.getByRole('button', { name: /easy apply/i }).first();
    if (!(await ea.isVisible().catch(() => false))) {
      const ext = page.getByRole('button', { name: /^apply/i }).or(page.getByRole('link', { name: /^apply/i })).first();
      let extUrl = '';
      if (await ext.isVisible().catch(() => false)) {
        const [popup] = await Promise.all([bctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), ext.click().catch(() => {})]);
        if (popup) { await popup.waitForLoadState('domcontentloaded').catch(() => {}); extUrl = popup.url(); await popup.close().catch(() => {}); }
      }
      await page.close();
      return { ok: true, result: 'no_easy_apply', detail: extUrl ? 'external: ' + extUrl : 'no Easy Apply button', externalUrl: extUrl, meta };
    }
    await ea.click();
    let dlg = page.locator('dialog').filter({ has: page.getByRole('button', { name: /next|review|submit|continue/i }) }).first();
    await dlg.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (!(await dlg.isVisible().catch(() => false))) {
      // safety/"job search safety reminder" interstitial → continue
      const cont = page.getByRole('button', { name: /continue applying|^continue$/i }).first();
      if (await cont.isVisible().catch(() => false)) { await cont.click(); await dlg.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {}); }
    }
    // If we matched a "Job search safety reminder" dialog (no real form fields), dismiss it and re-find the real apply dialog.
    if (await dlg.isVisible().catch(() => false)) {
      const dlgText = await dlg.innerText().catch(() => '');
      if (/safety reminder|safety tips|research the company|report suspicious/i.test(dlgText)) {
        const contBtn = dlg.getByRole('link', { name: /continue applying/i }).or(dlg.getByRole('button', { name: /continue applying/i })).first();
        if (await contBtn.isVisible().catch(() => false)) {
          await contBtn.click().catch(() => {});
          await SLEEP(1500);
          // re-select the actual apply dialog (not the safety one)
          dlg = page.locator('dialog').filter({ has: page.getByRole('button', { name: /next|review|submit/i }) }).first();
          await dlg.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
        }
      }
    }
    if (!(await dlg.isVisible().catch(() => false))) {
      await encounter('easy_apply', 'dialog did not open', { url, page });
      await page.close(); return { ok: false, result: 'error', detail: 'Easy Apply dialog did not open', meta };
    }

    let lastProgress = '', same = 0;
    for (let step = 0; step < 15 && Date.now() - t0 < timeoutMs; step++) {
      await fillPage(page, dlg, ctx, job);
      await SLEEP(500);
      const submit = dlg.getByRole('button', { name: /submit application/i }).first();
      if (await submit.isVisible().catch(() => false)) {
        if (dryRun) { await discard(page); await page.close(); return { ok: true, result: 'dry_run_ready', detail: `reached submit at step ${step}`, meta }; }
        await submit.click();
        await SLEEP(3500);
        await page.getByRole('button', { name: /^done$|dismiss/i }).first().click({ timeout: 3000 }).catch(() => {});
        const ok = await verifyApplied(page, url);
        if (!ok) await encounter('easy_apply', 'submit clicked but not confirmed', { url, page });
        await page.close().catch(() => {});
        return { ok, result: ok ? 'applied' : 'stuck', detail: ok ? `submitted + verified (${step + 1} pages)` : 'submit not confirmed', meta, used: ctx.used };
      }
      const next = dlg.getByRole('button', { name: /continue to next step|review your application|^next$|^review$/i }).first();
      if (!(await next.isVisible().catch(() => false))) { await encounter('easy_apply', 'no next/submit button', { url, page, scope: dlg }); break; }
      await next.click().catch(() => {});
      await SLEEP(1600);
      const st = await dlg.evaluate(SCAN).catch(() => ({ progress: '', errors: [] }));
      if (st.progress === lastProgress && st.progress) {
        same++;
        // a validation error usually means a numeric field got text, or a choice we didn't pick
        for (const f of st.fields.filter(f => f.required && !f.val && !f.checked && f.type !== 'radio' && f.type !== 'checkbox')) { ctx.unanswered.add(f.q); askLater(f.q, f.opts?.slice(1) || []); }
        if (same >= 2) {
          // REASONING STEP: analyze the stuck page so we know exactly which required fields are
          // unresolved and why, and bake that into the encounter so the fix is obvious.
          const analysis = await analyzePage(dlg).catch(() => null);
          if (analysis) {
            for (const b of analysis.blocking) { ctx.unanswered.add(b.q); }
            const summary = analysis.blocking.length
              ? 'blocking: ' + analysis.blocking.map(b => `${b.q} [${b.kind}] (${b.reason})`).join(' | ')
              : (analysis.errors.join(' | ') || 'all fields resolved but page would not advance');
            if (!ctx.unanswered.size || !analysis.blocking.length) {
              await encounter('easy_apply', `stuck on "${analysis.heading}": ${summary}`.slice(0, 580), { url, page, scope: dlg });
            }
          } else if (!ctx.unanswered.size) {
            await encounter('easy_apply', `stuck on page "${st.heading}": ${st.errors.join(' | ')}`, { url, page, scope: dlg });
          }
          break;
        }
      } else same = 0;
      lastProgress = st.progress;
    }
    await discard(page);
    await page.close().catch(() => {});
    const qs = [...ctx.unanswered];
    return qs.length
      ? { ok: false, result: 'needs_answers', detail: 'needs your answer: ' + qs.slice(0, 4).join(' | ').slice(0, 300), questions: qs, meta }
      : { ok: false, result: 'stuck', detail: 'could not advance (see Evolution tab)', meta };
  } catch (e) {
    await encounter('easy_apply', 'exception: ' + e.message.split('\n')[0], { url, page }).catch(() => {});
    await discard(page).catch(() => {});
    await page.close().catch(() => {});
    return { ok: false, result: 'error', detail: e.message.slice(0, 200), questions: [...ctx.unanswered], meta };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// AGENT-DRIVEN REASONING PATH
// Every Easy Apply form is different, so instead of only pattern-matching we let the AGENT
// reason over the whole form using the CV + profile. Two steps:
//   1) inspectEasyApply(url)  → returns the full ordered field list across all pages (no fill)
//   2) applyEasyApplyWithAnswers(url, answers) → fills using the agent's answers (keyed by the
//      question text), with the built-in engine as a fallback for anything the agent omitted,
//      then submits + verifies.
// ──────────────────────────────────────────────────────────────────────────────

async function openEasyApplyDialog(page, url, t0, timeoutMs) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await SLEEP(3000);
  const meta = await page.evaluate(() => {
    const main = (document.querySelector('main') || document.body).innerText;
    return { posted: (main.match(/(\d+\s+(minute|hour|day|week|month)s?\s+ago)/) || [])[1] || '', head: main.slice(0, 1500) };
  });
  if (APPLIED_RE.test(meta.head)) return { done: { ok: true, result: 'already_applied', detail: 'already applied', meta } };
  if (/no longer accepting applications/i.test(meta.head)) return { done: { ok: true, result: 'closed', detail: 'closed', meta } };
  if (/limit daily submissions|apply tomorrow|reached your daily|daily (submission|application) limit/i.test(meta.head)) return { done: { ok: false, result: 'daily_limit', detail: 'daily limit', meta } };
  const ea = page.getByRole('button', { name: /easy apply/i }).first();
  if (!(await ea.isVisible().catch(() => false))) return { done: { ok: true, result: 'no_easy_apply', detail: 'no Easy Apply button', meta } };
  await ea.click();
  let dlg = page.locator('dialog').filter({ has: page.getByRole('button', { name: /next|review|submit|continue/i }) }).first();
  await dlg.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  // dismiss the safety interstitial if present
  if (await dlg.isVisible().catch(() => false)) {
    const dlgText = await dlg.innerText().catch(() => '');
    if (/safety reminder|safety tips|research the company/i.test(dlgText)) {
      await dlg.getByRole('link', { name: /continue applying/i }).or(dlg.getByRole('button', { name: /continue applying/i })).first().click().catch(() => {});
      await SLEEP(1500);
      dlg = page.locator('dialog').filter({ has: page.getByRole('button', { name: /next|review|submit/i }) }).first();
      await dlg.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    }
  }
  if (!(await dlg.isVisible().catch(() => false))) return { done: { ok: false, result: 'error', detail: 'dialog did not open', meta } };
  return { dlg, meta };
}

/**
 * Inspect an Easy Apply form WITHOUT submitting. Walks every page and returns the full ordered
 * list of fields so the agent can reason over them with the CV + profile.
 * @returns {Promise<{ok:boolean, result:string, pages:Array, fields:Array, meta?:object}>}
 */
export async function inspectEasyApply({ url, timeoutMs = 120000 }) {
  const bctx = await getContext();
  const page = await bctx.newPage();
  page.setDefaultTimeout(15000);
  const t0 = Date.now();
  try {
    const opened = await openEasyApplyDialog(page, url, t0, timeoutMs);
    if (opened.done) { await page.close().catch(() => {}); return { ok: opened.done.ok, result: opened.done.result, detail: opened.done.detail, pages: [], fields: [], meta: opened.done.meta }; }
    const dlg = opened.dlg;
    const pages = [];
    const seen = new Set();
    for (let step = 0; step < 15 && Date.now() - t0 < timeoutMs; step++) {
      const scan = await dlg.evaluate(SCAN).catch(() => ({ fields: [], radioGroupOptions: {}, heading: '' }));
      // Collapse radio/checkbox inputs into one logical question each, attaching their options.
      const logical = [];
      const grpSeen = new Set();
      for (const f of scan.fields) {
        if (f.type === 'hidden') continue;
        if (f.type === 'radio' || f.type === 'checkbox') {
          const key = f.name || f.q; if (grpSeen.has(key)) continue; grpSeen.add(key);
          const group = scan.fields.filter(x => (x.name || x.q) === key && x.type === f.type);
          const raw = group.map(r => (r.optLabel || '').trim());
          const captured = scan.radioGroupOptions?.[(f.q || '').slice(0, 120)];
          const opts = raw.every(l => !l)
            ? (Array.isArray(captured) && captured.length === group.length ? captured : (group.length === 2 ? ['Yes', 'No'] : raw))
            : raw;
          logical.push({ question: f.q, type: f.type === 'radio' ? 'single-choice' : 'multi-choice', options: opts, required: !!f.required });
        } else if (f.tag === 'SELECT') {
          logical.push({ question: f.q, type: 'select', options: (f.opts || []).filter(o => o && !/^select/i.test(o)), required: !!f.required });
        } else if (f.type === 'file') {
          logical.push({ question: f.q || 'Resume', type: 'file', required: !!f.required });
        } else {
          logical.push({ question: f.q, type: f.tag === 'TEXTAREA' ? 'long-text' : 'text', maxlength: f.maxlength || 0, required: !!f.required });
        }
      }
      pages.push({ step, heading: scan.heading, fields: logical });
      for (const l of logical) seen.add(l.question);
      // advance
      const submit = dlg.getByRole('button', { name: /submit application/i }).first();
      if (await submit.isVisible().catch(() => false)) { pages.push({ step: step + 1, heading: 'Submit', terminal: true, fields: [] }); break; }
      const next = dlg.getByRole('button', { name: /continue to next step|review your application|^next$|^review$/i }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click().catch(() => {});
      await SLEEP(1500);
    }
    await discard(page);
    await page.close().catch(() => {});
    const fields = pages.flatMap(p => p.fields.map(f => ({ ...f, page: p.step })));
    return { ok: true, result: 'inspected', pages, fields, meta: opened.meta };
  } catch (e) {
    await discard(page).catch(() => {});
    await page.close().catch(() => {});
    return { ok: false, result: 'error', detail: e.message.slice(0, 200), pages: [], fields: [] };
  }
}

/**
 * Apply using the AGENT's reasoned answers. `answers` is a map of question-text → answer
 * (string for text/select/single-choice; array or comma string for multi-choice). Anything
 * not provided falls back to the built-in answer engine so a partial map still completes.
 * Submits and verifies.
 */
export async function applyEasyApplyWithAnswers({ url, answers = {}, timeoutMs = 180000, dryRun = false, job = {} }) {
  const bctx = await getContext();
  const page = await bctx.newPage();
  page.setDefaultTimeout(15000);
  const t0 = Date.now();
  const ctx = { unanswered: new Set(), used: [], agentAnswers: answers };
  try {
    const opened = await openEasyApplyDialog(page, url, t0, timeoutMs);
    if (opened.done) { await page.close().catch(() => {}); return { ...opened.done }; }
    const dlg = opened.dlg;
    let lastProgress = '', same = 0;
    for (let step = 0; step < 15 && Date.now() - t0 < timeoutMs; step++) {
      // fillPage reads ctx.agentAnswers first, then falls back to the engine.
      await fillPage(page, dlg, ctx, job);
      await SLEEP(500);
      const submit = dlg.getByRole('button', { name: /submit application/i }).first();
      if (await submit.isVisible().catch(() => false)) {
        if (dryRun) { await discard(page); await page.close(); return { ok: true, result: 'dry_run_ready', detail: `reached submit at step ${step}` }; }
        await submit.click(); await SLEEP(3500);
        await page.getByRole('button', { name: /^done$|dismiss/i }).first().click({ timeout: 3000 }).catch(() => {});
        const ok = await verifyApplied(page, url);
        await page.close().catch(() => {});
        return { ok, result: ok ? 'applied' : 'stuck', detail: ok ? `submitted + verified (${step + 1} pages)` : 'submit not confirmed', used: ctx.used };
      }
      const next = dlg.getByRole('button', { name: /continue to next step|review your application|^next$|^review$/i }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click().catch(() => {});
      await SLEEP(1600);
      const st = await dlg.evaluate(SCAN).catch(() => ({ progress: '' }));
      if (st.progress && st.progress === lastProgress) { if (++same >= 2) { const a = await analyzePage(dlg).catch(() => null); const blk = a ? a.blocking.map(b => `${b.q} (${b.reason})`).join(' | ') : ''; await discard(page); await page.close(); return { ok: false, result: 'stuck', detail: 'could not advance — ' + (blk || 'validation'), blocking: a?.blocking || [] }; } } else same = 0;
      lastProgress = st.progress;
    }
    await discard(page); await page.close().catch(() => {});
    return { ok: false, result: 'stuck', detail: 'did not reach submit', unanswered: [...ctx.unanswered] };
  } catch (e) {
    await discard(page).catch(() => {});
    await page.close().catch(() => {});
    return { ok: false, result: 'error', detail: e.message.slice(0, 200) };
  }
}
