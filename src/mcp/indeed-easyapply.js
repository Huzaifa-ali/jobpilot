// src/mcp/indeed-easyapply.js — Indeed Pakistan smartapply Easy Apply driver.
// Mirrors src/mcp/easyapply.js (LinkedIn): attaches to the user's debug Chrome over CDP :9222
// via getContext(), fills with the shared answer engine, parks unknowns as questions-for-you,
// records encounters with screenshots, and VERIFIES success before counting an apply.
//
// ANTI-WALL RULE (critical): Indeed walls (Cloudflare "Just a moment") on direct viewjob?jk=
// navigation. We navigate ONCE to the Pakistan "Easily apply" results page, then click job
// cards IN-PAGE (the URL gains &vjk=<jk> with no full navigation). Never page.goto() a
// viewjob URL. Repeated rapid goto() to the results URL also walls, so navigate sparingly,
// reuse a clean results tab, add generous jittered cooldowns, and on any wall COOL DOWN —
// never try to solve it.
//
// GLASSDOOR: in-site Easy Apply resolves to smartapply.indeed.com and is REFUSED
// (see docs/paths/glassdoor/path.md). This module intentionally has NO Glassdoor submit path —
// Indeed is the only real submitting channel. Glassdoor listings, if discovered elsewhere, must
// be routed as external/needs_manual with a non-indeed_easy channel so the applier never fakes
// a Glassdoor submit.
import { getContext } from '../agent/browser.js';
import { getProfile } from '../profile.js';
import { textAnswer, choiceAnswer } from './answers.js';
import { askLater, encounter } from '../evolve.js';
import { getJob, alreadyApplied, setStatus } from '../tracker.js';
import { score, relToIso } from './sources.js';

const SLEEP = ms => new Promise(r => setTimeout(r, ms));

// Pakistan "Easily apply" results URL. sc=0kf:attr(DSQF7); = the Easily-apply-only filter.
const PK_RESULTS = (q) =>
  `https://pk.indeed.com/jobs?q=${encodeURIComponent(q)}&l=Pakistan&sort=date&sc=0kf%3Aattr(DSQF7)%3B`;

const WALL_RE = /just a moment|additional verification|security check|humans only/i;
const SUBMIT_RE = /submit (your )?application|^submit$/i;
const APPLY_NOW_RE = /^apply now$/i;
const CONTINUE_RE = /^(continue|next|review)$/i;
const SUCCESS_URL_RE = /\/form\/post-apply/i;
const SUCCESS_BODY_RE = /application has been submitted/i;
const SMARTAPPLY_HOST = 'smartapply.indeed.com';

// ── Wall detection ─────────────────────────────────────────────────────────────
// Read title + a slice of body and match the Cloudflare / verification wall. Never solve it;
// the caller treats a wall as a cooldown trigger.
async function hitWall(page) {
  try {
    const t = await page.title().catch(() => '');
    const b = await page.evaluate(() => (document.body?.innerText || '').slice(0, 1500)).catch(() => '');
    return WALL_RE.test(`${t} ${b}`);
  } catch { return false; }
}

// Pull the jk out of a stored canonical/apply url (jk= or vjk=), else ''.
function jkFromUrl(url = '') {
  const m = String(url).match(/[?&]v?jk=([a-z0-9]+)/i);
  return m ? m[1] : '';
}

// ── In-page card navigation (never goto a viewjob URL) ──────────────────────────
// Given a clean results page already on pk.indeed.com/jobs, click the card for a given jk (or
// the Nth card) so the right-hand detail pane loads WITHOUT a full navigation (avoids the wall).
// Returns true if the detail pane updated (URL carries vjk= or an Apply control is now visible).
async function openCardInPage(page, { jk = '', index = 0 } = {}) {
  const selectors = ['a.jcs-JobTitle', 'a[data-jk]', 'h2.jobTitle a'];
  const clicked = await page.evaluate(({ sels, jk, index }) => {
    const seen = [];
    for (const s of sels) for (const el of document.querySelectorAll(s)) if (!seen.includes(el)) seen.push(el);
    if (!seen.length) return false;
    let target = null;
    if (jk) target = seen.find(a => (a.getAttribute('data-jk') === jk) || (a.href || '').includes('jk=' + jk));
    if (!target) target = seen[Math.min(index, seen.length - 1)];
    if (!target) return false;
    target.scrollIntoView({ block: 'center' });
    target.click();
    return true;
  }, { sels: selectors, jk, index }).catch(() => false);
  if (!clicked) return false;
  await SLEEP(2500);
  if (await hitWall(page)) return false;
  const urlOk = /[?&]vjk=/.test(page.url());
  const applyVisible = await page.locator('a, button, span').filter({ hasText: APPLY_NOW_RE }).first().isVisible().catch(() => false);
  return urlOk || applyVisible;
}

// ── smartapply popup opener ──────────────────────────────────────────────────
// Click the in-pane "Apply now" control and capture the popup it opens. Returns:
//   { popup }         — a smartapply.indeed.com popup (the real Easy Apply flow)
//   { external, popup }— popup is a non-smartapply (company-site) apply → mark needs_manual
//   { none: true }    — no Apply control / no popup opened
async function openSmartApply(page, bctx) {
  const applyCtl = page.locator('a, button, span').filter({ hasText: APPLY_NOW_RE }).first();
  if (!(await applyCtl.isVisible().catch(() => false))) return { none: true };
  const [popup] = await Promise.all([
    bctx.waitForEvent('page', { timeout: 12000 }).catch(() => null),
    applyCtl.click().catch(() => {}),
  ]);
  if (!popup) return { none: true };
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await SLEEP(2000);
  const url = popup.url();
  if (!url.includes(SMARTAPPLY_HOST)) return { external: url, popup };
  return { popup };
}

// ── React-safe value setter ──────────────────────────────────────────────────
// Set an input/textarea value so React's onChange fires (native setter + event dispatch).
async function setReactValue(handle, value) {
  await handle.evaluate((el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, v) : (el.value = v);
    for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true }));
  }, value).catch(() => {});
}

const pickYes = opts => opts.find(o => /^yes/i.test(o)) || opts[0];
const pickNo = opts => opts.find(o => /^no/i.test(o)) || opts[opts.length - 1];

// Resolve the answer for an Indeed smartapply question using the shared engine + profile rules.
// Returns { value } for text/number, { pick } for a chosen radio label, or { unknown:true }.
function resolveIndeedAnswer(question, { kind, options = [], profile }) {
  const q = (question || '').toLowerCase();
  // "Are you located in <city>?" → No when the profile city differs (e.g. Karachi).
  if (kind === 'radio' && /are you located in/.test(q)) {
    const city = (profile.location || '').split(',')[0].trim().toLowerCase();
    const inCity = city && q.includes(city);
    return { pick: inCity ? pickYes(options) : pickNo(options) };
  }
  // "Will you be able to reliably commute or relocate to <city>?" → workAuth.willingToRelocate.
  if (kind === 'radio' && /(commute|relocate)/.test(q)) {
    return { pick: profile.workAuth?.willingToRelocate ? pickYes(options) : pickNo(options) };
  }
  // numeric years-of-experience / salary → engine (salary routed through salaryFor via textAnswer).
  if (kind === 'number' || /how many years|years of|salary|compensation|expected pay|current (pay|salary)/.test(q)) {
    const v = textAnswer(question, { numeric: true });
    if (v != null && v !== '') return { value: String(v) };
  }
  // generic text
  if (kind === 'text') {
    const v = textAnswer(question);
    if (v != null && v !== '') return { value: String(v) };
  }
  // generic radio via choiceAnswer
  if (kind === 'radio') {
    const pick = choiceAnswer(question, options);
    if (pick) return { pick };
  }
  return { unknown: true };
}

// Scan the current smartapply module's visible questions. Groups radios by name/fieldset, pairs
// text/number inputs with their labels, and reports the module kind. All DOM reads stay inside
// popup.evaluate so nothing crosses the boundary but plain data.
const SCAN_SMARTAPPLY = () => {
  const text = (document.body?.innerText || '');
  const moduleEl = document.querySelector('[class*="resume-selection-module"], [class*="questions-module"], [class*="review-module"]');
  const moduleKind =
    document.querySelector('[class*="review-module"]') ? 'review'
    : document.querySelector('[class*="resume-selection-module"]') ? 'resume'
    : document.querySelector('[class*="questions-module"]') ? 'questions'
    : 'unknown';
  const labelFor = (el) => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.innerText.trim()) return l.innerText.trim(); }
    const fs = el.closest('fieldset'); const lg = fs?.querySelector('legend'); if (lg?.innerText.trim()) return lg.innerText.trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    let p = el.parentElement;
    for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
      const line = (p.innerText || '').split('\n').map(s => s.trim()).find(s => s.length > 6 && !/^(yes|no)$/i.test(s));
      if (line) return line;
    }
    return el.name || el.placeholder || '';
  };
  const nonce = Math.random().toString(36).slice(2, 7);
  const inputs = [...document.querySelectorAll('input, textarea')].filter(el => el.type !== 'hidden' && !el.disabled);
  const radios = {}; const fields = []; let i = 0;
  for (const el of inputs) {
    const iid = 'ia' + nonce + (i++); el.setAttribute('data-ia', iid);
    if (el.type === 'radio') {
      const key = el.name || labelFor(el);
      (radios[key] ||= { question: '', options: [], ids: [], required: false });
      const g = radios[key];
      const optLabel = (el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText || '') : '').trim()
        || (el.closest('label')?.innerText || '').trim() || el.value || '';
      g.options.push(optLabel); g.ids.push(iid);
      if (!g.question) {
        const fs = el.closest('fieldset'); const lg = fs?.querySelector('legend');
        g.question = (lg?.innerText || el.getAttribute('aria-label') || '').trim();
        if (!g.question) {
          let p = el.parentElement;
          for (let k = 0; k < 8 && p; k++, p = p.parentElement) {
            const line = (p.innerText || '').split('\n').map(s => s.trim()).find(s => s.length > 8 && !/^(yes|no)$/i.test(s));
            if (line && p.querySelectorAll('input[type="radio"]').length < 10) { g.question = line; break; }
          }
        }
      }
      if (el.required || el.getAttribute('aria-required') === 'true') g.required = true;
    } else {
      const q = (labelFor(el) || '').replace(/\s+/g, ' ').trim();
      fields.push({
        id: iid, kind: el.type === 'number' || el.getAttribute('inputmode') === 'numeric' ? 'number'
          : el.tagName === 'TEXTAREA' ? 'text' : (el.type === 'text' || el.type === 'tel' || el.type === 'email') ? 'text' : el.type,
        q: q.replace(/\s*\*\s*$/, '').slice(0, 300),
        val: el.value || '',
        required: el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(q),
      });
    }
  }
  const radioGroups = Object.values(radios).map(g => ({ ...g, question: (g.question || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').slice(0, 300) }));
  return { moduleKind, hasModule: !!moduleEl, fields, radioGroups, text: text.slice(0, 400) };
};

// Walk the smartapply modules (resume → questions → review). Fills each page's questions from
// the shared engine; parks unknown REQUIRED questions via askLater and flags ctx.parked so the
// caller leaves the application as a draft and never submits with blanks. Returns when a
// review-module (or submit button) is reached, or after a bounded number of steps.
async function fillSmartApply(popup, { job, ctx }) {
  const profile = getProfile();
  for (let step = 0; step < 12; step++) {
    if (await hitWall(popup)) { ctx.wall = true; return; }
    const scan = await popup.evaluate(SCAN_SMARTAPPLY).catch(() => null);
    if (!scan) return;

    // review-module → stop here; the caller handles captcha check + verified submit.
    if (scan.moduleKind === 'review') return;

    // resume-selection-module: leave the preselected uploaded CV, just continue.
    // (Indeed preselects the user's uploaded resume; we don't change the selection.)

    // Fill text / number fields.
    for (const f of scan.fields) {
      if (f.val && f.val.trim()) continue;
      const a = resolveIndeedAnswer(f.q, { kind: f.kind, profile });
      if (a.value != null) {
        const handle = popup.locator(`[data-ia="${f.id}"]`);
        await setReactValue(handle, a.value);
      } else if (f.required) {
        ctx.parked = true; ctx.unanswered.push(f.q); askLater(f.q);
      }
    }

    // Fill radio groups.
    for (const g of scan.radioGroups) {
      const already = await popup.evaluate((ids) => ids.some(id => {
        const el = document.querySelector(`[data-ia="${id}"]`); return el && el.checked;
      }), g.ids).catch(() => false);
      if (already) continue;
      const opts = (g.options || []).map(o => String(o || '').trim());
      const a = resolveIndeedAnswer(g.question, { kind: 'radio', options: opts, profile });
      if (a.pick) {
        const idx = opts.findIndex(o => o.toLowerCase() === String(a.pick).toLowerCase());
        const targetId = idx >= 0 ? g.ids[idx] : g.ids[0];
        const loc = popup.locator(`[data-ia="${targetId}"]`);
        await loc.check({ force: true }).catch(async () => {
          // some smartapply radios are 0×0 → click the enclosing label as a fallback
          await loc.evaluate(el => { const l = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null; (l || el).click(); }).catch(() => {});
        });
      } else if (g.required) {
        ctx.parked = true; ctx.unanswered.push(g.question); askLater(g.question, opts);
      }
    }

    await SLEEP(600);

    // Advance: Continue / Next / Review.
    const cont = popup.locator('button, a, span').filter({ hasText: CONTINUE_RE }).first();
    const review = popup.locator('button, a, span').filter({ hasText: /review (your )?application|^review$/i }).first();
    const advance = (await review.isVisible().catch(() => false)) ? review
      : (await cont.isVisible().catch(() => false)) ? cont : null;
    if (!advance) {
      // No visible way forward and no review module → record it so it can be fixed in code.
      await encounter('indeed_easy', `no continue/submit on ${scan.moduleKind} module`, { url: popup.url(), page: popup });
      ctx.stuck = true;
      return;
    }
    await advance.click().catch(() => {});
    await SLEEP(2500);
  }
}

// ── review-module captcha detector + verified submit ────────────────────────
// A REAL challenge = a visibly-sized challenge iframe only. The passive invisible reCAPTCHA
// badge / "protected by reCAPTCHA" footer is NOT a challenge and is ignored.
async function realCaptchaPresent(popup) {
  return popup.evaluate(() => {
    const re = /bframe|hcaptcha.*challenge|challenges\.cloudflare/i;
    for (const f of document.querySelectorAll('iframe')) {
      const src = f.src || f.getAttribute('src') || '';
      if (!re.test(src)) continue;
      const r = f.getBoundingClientRect();
      if (r.width > 100 && r.height > 100 && f.offsetParent !== null) return true;
    }
    return false;
  }).catch(() => false);
}

async function submitAndVerify(popup) {
  await popup.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  const submit = popup.locator('button, a, span').filter({ hasText: SUBMIT_RE }).first();
  if (!(await submit.isVisible().catch(() => false))) return { ok: false, reason: 'no submit button' };
  await submit.click().catch(() => {});
  await SLEEP(4000);
  const url = popup.url();
  const body = await popup.evaluate(() => document.body?.innerText || '').catch(() => '');
  // SUCCESS is verified ONLY by the post-apply URL or the confirmation text — a click is NOT success.
  const ok = SUCCESS_URL_RE.test(url) || SUCCESS_BODY_RE.test(body);
  return { ok, reason: ok ? 'verified' : 'submit clicked but not confirmed' };
}

// Reuse a clean pk.indeed.com/jobs results tab if one is already open (avoids re-navigation /
// walls); otherwise navigate ONCE to the results page for the query.
async function cleanResultsPage(bctx, query) {
  for (const p of bctx.pages()) {
    try { if (/pk\.indeed\.com\/jobs/.test(p.url()) && !(await hitWall(p))) return { page: p, reused: true }; } catch {}
  }
  const page = await bctx.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(PK_RESULTS(query), { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await SLEEP(3000);
  return { page, reused: false };
}

/**
 * Apply to one Indeed Pakistan Easy-Apply job via smartapply.
 * Returns { ok, result, detail, externalUrl? } mirroring the LinkedIn module.
 * result: applied | already_applied | needs_answers | no_easy_apply | captcha | stuck | error
 */
export async function indeedEasyApply({ url, job = {} }) {
  const bctx = await getContext();
  const query = job.role || (getProfile().preferences?.roles || [])[0] || 'AI Engineer';
  const jk = job.jk || jkFromUrl(job.url || job.apply_url || url);
  const ctx = { unanswered: [], parked: false, wall: false, stuck: false };
  let resultsPage = null, reused = false, popup = null;
  try {
    // Dedup first.
    const existing = url ? getJob(url) : null;
    if ((existing && ['applied', 'skipped_duplicate'].includes(existing.status)) || (job.company && job.role && alreadyApplied(job.company, job.role))) {
      return { ok: true, result: 'already_applied', detail: 'already actioned (dedup)' };
    }

    const rp = await cleanResultsPage(bctx, query);
    resultsPage = rp.page; reused = rp.reused;
    if (await hitWall(resultsPage)) {
      await encounter('indeed_easy', 'cloudflare wall — cooldown', { url, page: resultsPage });
      return { ok: false, result: 'captcha', detail: 'wall' };
    }

    // Open the job card IN-PAGE (never goto a viewjob URL).
    const opened = await openCardInPage(resultsPage, { jk, index: 0 });
    if (ctx.wall || await hitWall(resultsPage)) {
      await encounter('indeed_easy', 'cloudflare wall — cooldown', { url, page: resultsPage });
      return { ok: false, result: 'captcha', detail: 'wall' };
    }
    if (!opened) {
      return { ok: false, result: 'stuck', detail: 'could not open job card in-page' };
    }

    // Open the smartapply popup.
    const sa = await openSmartApply(resultsPage, bctx);
    if (sa.popup) popup = sa.popup;
    if (sa.none) {
      return { ok: false, result: 'no_easy_apply', detail: 'no Apply now / popup' };
    }
    if (sa.external) {
      if (url) setStatus(url, 'needs_manual', 'external/company-site apply: ' + sa.external);
      return { ok: true, result: 'no_easy_apply', detail: 'external/company-site apply', externalUrl: sa.external };
    }

    // Walk resume → questions → review.
    await fillSmartApply(popup, { job, ctx });

    if (ctx.wall) {
      await encounter('indeed_easy', 'cloudflare wall — cooldown', { url, page: popup });
      return { ok: false, result: 'captcha', detail: 'wall' };
    }
    if (ctx.parked) {
      if (url) setStatus(url, 'draft', 'needs your answer: ' + ctx.unanswered.slice(0, 4).join(' | ').slice(0, 300));
      return { ok: false, result: 'needs_answers', detail: 'needs your answer: ' + ctx.unanswered.slice(0, 4).join(' | ').slice(0, 300), questions: ctx.unanswered };
    }
    if (ctx.stuck) {
      return { ok: false, result: 'stuck', detail: 'could not advance smartapply modules' };
    }

    // At review-module: real captcha → STOP (leave draft), else verified submit.
    if (await realCaptchaPresent(popup)) {
      if (url) setStatus(url, 'draft', 'captcha at review — user must solve');
      await encounter('indeed_easy', 'captcha at review — user must solve', { url, page: popup });
      return { ok: false, result: 'captcha', detail: 'captcha at review — user must solve' };
    }

    const sub = await submitAndVerify(popup);
    if (sub.ok) {
      if (url) setStatus(url, 'applied', 'submitted + verified');
      return { ok: true, result: 'applied', detail: 'submitted + verified' };
    }
    await encounter('indeed_easy', 'submit clicked but not confirmed', { url, page: popup });
    return { ok: false, result: 'stuck', detail: sub.reason };
  } catch (e) {
    await encounter('indeed_easy', 'exception: ' + (e.message || String(e)).split('\n')[0], { url, page: popup || resultsPage }).catch(() => {});
    return { ok: false, result: 'error', detail: (e.message || String(e)).slice(0, 200) };
  } finally {
    // Close the popup and any extra pages, but LEAVE the clean results tab open for reuse
    // (re-navigating the results URL is a wall trigger).
    try { if (popup) await popup.close().catch(() => {}); } catch {}
    try { if (resultsPage && !reused) { /* keep it open for the next lead to reuse */ } } catch {}
  }
}

/**
 * Discover Pakistan Easy-Apply listings. Navigates ONCE to PK_RESULTS(query) and scrapes each
 * visible job card into a lead (never direct viewjob goto). On a wall, returns { ok:false }.
 * Each lead: { jk, role, company, location, url, applyUrl, channel:'indeed_easy', ... }.
 * Signature: indeedEasyApplyListings(query, { pages = 1 } = {}) → { ok, leads, detail }.
 */
export async function indeedEasyApplyListings(query, { pages = 1 } = {}) {
  console.error('[indeed] listings: starting, query=' + query);
  let ctx;
  try { ctx = await getContext(); } catch (e) {
    console.error('[indeed] listings: getContext() failed:', e.message);
    return { ok: false, leads: [], detail: `browser error: ${e.message}` };
  }
  let page;
  try { page = await ctx.newPage(); } catch (e) {
    console.error('[indeed] listings: newPage() failed:', e.message);
    return { ok: false, leads: [], detail: `new page error: ${e.message}` };
  }
  page.setDefaultTimeout(30000);
  const out = [];
  try {
    await page.goto(PK_RESULTS(query), { waitUntil: 'domcontentloaded', timeout: 40000 });
    await SLEEP(3000);
    if (await hitWall(page)) {
      console.error('[indeed] listings: hit cloudflare wall — cooling down');
      return { ok: false, leads: [], detail: 'wall' };
    }
    // Scrape each visible job card. Build url as the canonical viewjob URL for DEDUP ONLY —
    // it is never navigated directly (that walls).
    const cards = await page.evaluate(() => {
      const sels = ['a.jcs-JobTitle', 'a[data-jk]', 'h2.jobTitle a'];
      const seen = [];
      for (const s of sels) for (const el of document.querySelectorAll(s)) if (!seen.includes(el)) seen.push(el);
      return seen.map(a => {
        const card = a.closest('.job_seen_beacon, .cardOutline, li, td.resultContent') || a.parentElement;
        const jk = a.getAttribute('data-jk') || (a.href.match(/[?&]jk=([a-z0-9]+)/i) || [])[1] || '';
        const role = (a.innerText || a.getAttribute('title') || '').trim();
        const company = (card?.querySelector('[data-testid="company-name"], .companyName, span.companyName')?.innerText || '').trim();
        const location = (card?.querySelector('[data-testid="text-location"], .companyLocation, div.companyLocation')?.innerText || '').trim();
        const dateTxt = (card?.querySelector('[data-testid="myJobsStateDate"], .date, span.date')?.innerText || '').trim();
        const text = (card?.innerText || '').replace(/\s+/g, ' ').trim();
        return { jk, role, company, location, dateTxt, text };
      }).filter(c => c.jk);
    }).catch(() => []);

    const seen = new Set();
    for (const c of cards) {
      if (seen.has(c.jk)) continue; seen.add(c.jk);
      const s = score(`${c.role} ${c.company} ${c.location} ${c.text}`, c.role);
      out.push({
        jk: c.jk,
        role: c.role,
        company: c.company,
        location: c.location || 'Pakistan',
        url: `https://pk.indeed.com/viewjob?jk=${c.jk}`,     // canonical, DEDUP ONLY — never goto directly
        applyUrl: `https://pk.indeed.com/viewjob?jk=${c.jk}`,
        channel: 'indeed_easy',
        source: 'indeed_easy',
        portal: 'indeed',
        posted_at: relToIso(c.dateTxt) || '',
        relevance: s.rel,
        skip: s.skip,
        skipWhy: s.why,
        remote: /remote/i.test(c.location + ' ' + c.text),
      });
    }
    console.error(`[indeed] listings: ${out.length} Easy-Apply leads`);
    return { ok: true, leads: out, detail: `${out.length} listings` };
  } catch (e) {
    console.error('[indeed] listings: error:', e.message);
    return { ok: false, leads: out, detail: e.message.slice(0, 200) };
  } finally { await page.close().catch(() => {}); }
}
