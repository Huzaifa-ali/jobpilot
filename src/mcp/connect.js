// src/mcp/connect.js — LinkedIn connection request with a personalized note (2026 UI).
// Robust to the two profile layouts:
//   A) primary action = "Connect" / "Invite <name> to connect" (button or link) in the top card
//   B) primary action = "Follow"; Connect lives under the top-card "More" menu as a role=link
// Scopes to the MAIN column (x<850) so sidebar "Invite ... to connect" buttons are never clicked.
// Note is attached when LinkedIn allows it; if the free note quota is exhausted it sends without one.
// result: connected | connected_no_note | already_pending | already_connected | no_connect | limit | error
import { getContext } from '../agent/browser.js';
import { getProfile } from '../profile.js';
import { encounter } from '../evolve.js';

const SLEEP = ms => new Promise(r => setTimeout(r, ms));

export function connectNote({ posterName, role, company }) {
  const p = getProfile();
  const first = (posterName || '').split(/\s+/)[0];
  const hi = /^[A-Z][a-z]{1,15}$/.test(first) ? `Hi ${first}, ` : 'Hi, ';
  const r = role && role.length < 45 ? role : 'the role';
  const co = company && company.length < 30 ? ` at ${company}` : '';
  const yrs = p.yearsExperience ? `${p.yearsExperience}+ yrs ` : '';
  const skills = (p.skills || []).slice(0, 3).join('/') || 'software';
  let note = `${hi}saw your post about ${r}${co}. I'm a ${p.headline || 'software engineer'} (${yrs}${skills}) and would love to be considered — happy to share my CV. ${p.links?.portfolio || ''}`;
  if (note.length > 200) note = `${hi}saw your post about ${r}${co}. ${p.headline || 'Engineer'}, ${yrs}${skills}. Would love to be considered. ${p.links?.portfolio || ''}`;
  return note.slice(0, 200);
}

// first matching button/link in the MAIN column (not the sidebar)
async function mainCol(page, re) {
  for (const role of ['button', 'link']) {
    const loc = page.getByRole(role, { name: re });
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      const inAside = await el.evaluate(e => !!e.closest('aside')).catch(() => true);
      if (inAside) continue;
      const b = await el.boundingBox().catch(() => null);
      if (b && b.x < 850 && b.y > 60) return el;
    }
  }
  return null;
}

export async function connect({ profileUrl, posterName, role, company, withNote = true, dryRun = false }) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await SLEEP(3000);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await SLEEP(800);

    const main = page.locator('main');
    if (await mainCol(page, /^pending$/i)) { await page.close(); return { ok: true, result: 'already_pending', detail: 'invite already pending' }; }
    const mtext = await main.innerText().catch(() => '');
    if (/\b1st\b|· 1st/.test(mtext.slice(0, 400))) { await page.close(); return { ok: true, result: 'already_connected', detail: '1st-degree already' }; }

    // A) direct Connect in the main column
    let connectEl = await mainCol(page, /^connect$|^invite .* to connect$/i);
    // B) under the main-column More menu
    if (!connectEl) {
      const more = await mainCol(page, /^more$/i);
      if (more) { await more.click().catch(() => {}); await SLEEP(1200); connectEl = page.getByRole('link', { name: /invite .* to connect|^connect$/i }).first(); if (!await connectEl.count().catch(() => 0)) connectEl = page.getByRole('menuitem', { name: /^connect/i }).first(); }
    }
    if (!connectEl || !(await connectEl.count().catch(() => 0))) {
      await encounter('connect', 'no Connect control (follow-only or restricted)', { url: profileUrl, page });
      await page.close(); return { ok: true, result: 'no_connect', detail: 'no Connect option (follow-only / limits)' };
    }
    await connectEl.click().catch(() => {});
    await SLEEP(2600);
    if (process.env.DEBUG_CONN) console.log('after connect click; addNote count', await page.getByRole('button', { name: /add a note/i }).count());

    // note dialog (may be in shadow — getByRole pierces it)
    let usedNote = false;
    const note = connectNote({ posterName, role, company });
    if (withNote) {
      const addNote = page.getByRole('button', { name: /add a note/i }).first();
      if (await addNote.isVisible().catch(() => false)) {
        await addNote.click(); await SLEEP(1000);
        const ta = page.locator('textarea').first();
        await ta.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        if (await ta.isVisible().catch(() => false)) { await ta.fill(note); await SLEEP(400); usedNote = true; }
        else if (process.env.DEBUG_CONN) console.log('textarea not visible after addNote');
      } else if (process.env.DEBUG_CONN) console.log('addNote not visible');
    }
    if (dryRun) { await page.keyboard.press('Escape').catch(() => {}); await SLEEP(400); await page.getByRole('button', { name: /discard/i }).first().click({ timeout: 2500 }).catch(() => {}); await page.close(); return { ok: true, result: usedNote ? 'dry_note_ready' : 'dry_ready', detail: 'reached send' + (usedNote ? ' with note' : ''), note: usedNote ? note : '' }; }

    // ── Send-button resolution (LinkedIn 2026) ───────────────────────────────────────────
    // LinkedIn 2026 uses native <dialog> elements with obfuscated CSS class names.
    // The page often has MULTIPLE open <dialog> elements (ad-option dialogs etc.) in the
    // DOM before the invite dialog appears.  We must locate the INVITE dialog specifically
    // rather than the first/last dialog on the page.
    //
    // Strategy:
    //  1. Wait for an invite-specific dialog: one whose heading contains "invite" / "connect"
    //     / "how do you know", or that contains a textarea (the note field).
    //  2. Look for the send/submit button first via JS (fastest, no Playwright selector
    //     race) — find any enabled button whose visible text / aria-label matches SEND_RE
    //     inside that invite dialog.
    //  3. If no invite dialog appears within 10 s, check for auto-sent Pending state.
    //  4. Fallback scans (secondary / tertiary) as before.
    const SEND_RE = /send without a note|send invitation|send now|^send$|^submit$/i;

    // JS-level search: find the invite dialog and its send button in one shot.
    const jsSend = async () => page.evaluate((sendRe) => {
      const re = new RegExp(sendRe, 'i');
      // Identify the invite dialog: contains a textarea OR heading with invite/connect/know.
      const INVITE_H = /how do you know|add a note|send.*invitation|connect/i;
      for (const dlg of document.querySelectorAll('dialog, [role="dialog"], .artdeco-modal')) {
        const headings = [...dlg.querySelectorAll('h1,h2,h3,legend,[role="heading"]')].map(e => e.innerText || '').join(' ');
        const hasTextarea = dlg.querySelector('textarea') !== null;
        const isInviteDlg = INVITE_H.test(headings) || hasTextarea;
        if (!isInviteDlg) continue;
        // Find an enabled send/submit button inside this dialog.
        for (const btn of dlg.querySelectorAll('button, input[type="submit"]')) {
          if (btn.disabled) continue;
          const label = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim();
          if (re.test(label)) return { found: true, label };
        }
        // Dialog found but button not yet enabled — signal to keep waiting.
        return { found: false, dialogOpen: true };
      }
      return { found: false, dialogOpen: false };
    }, SEND_RE.source).catch(() => ({ found: false, dialogOpen: false }));

    // Wait up to 12 s for the invite dialog + enabled send button.
    let sendVisible = false;
    let send = null;
    for (let i = 0; i < 15; i++) {
      const { found, dialogOpen } = await jsSend();
      if (found) { sendVisible = true; break; }
      if (i === 0 && !dialogOpen) {
        // No dialog yet — wait a bit longer before declaring failure.
      }
      await SLEEP(800);
    }

    // Build a Playwright locator for the send button (for clicking).
    if (sendVisible) {
      // Prefer the invite-dialog-scoped send button; fall back to page-wide.
      const inviteDlg = page.locator('dialog, [role="dialog"], .artdeco-modal').filter({
        has: page.locator('textarea, h2, h3').filter({ hasText: /how do you know|add a note|send.*invitation|connect/i })
      }).first();
      const dlgScope = (await inviteDlg.count().catch(() => 0)) ? inviteDlg : page;
      send = dlgScope.getByRole('button', { name: SEND_RE }).first()
        .or(dlgScope.locator('button[type="submit"]:not([disabled])').first());
    }

    if (!sendVisible) {
      // 2026 LinkedIn sometimes sends immediately on Connect click (no dialog / quota exhausted note path)
      // Check: Pending button, or "Pending" text anywhere in the top card area
      if (await mainCol(page, /^pending$/i)) { await page.close(); return { ok: true, result: 'connected_no_note', detail: 'invite sent instantly (no dialog)' }; }
      const bodyTxt = await page.locator('main').innerText().catch(() => '');
      if (/pending/i.test(bodyTxt.slice(0, 1000))) { await page.close(); return { ok: true, result: 'connected_no_note', detail: 'invite sent (pending state detected)' }; }

      // Secondary scan: any button on the page matching SEND_RE that is enabled.
      const secondarySend = page.locator('button').filter({ hasText: /send/i })
        .or(page.locator('[aria-label*="send" i][role="button"], [aria-label*="Send invitation" i]')).first();
      if (await secondarySend.isVisible().catch(() => false) && await secondarySend.isEnabled().catch(() => false)) {
        await secondarySend.click({ timeout: 5000 }).catch(() => {});
        await SLEEP(3000);
        const pendingNow = await mainCol(page, /^pending$/i);
        const bodyAfter = await page.locator('main').innerText().catch(() => '');
        if (pendingNow || /pending|invitation sent/i.test(bodyAfter.slice(0, 1000))) {
          await page.close();
          return { ok: true, result: 'connected_no_note', detail: 'invite sent via secondary send scan' };
        }
      }

      // Tertiary scan: JS-level click on any enabled send/submit button in any visible dialog.
      const jsClicked = await page.evaluate((sendRe) => {
        const re = new RegExp(sendRe, 'i');
        for (const dlg of document.querySelectorAll('dialog[open], [role="dialog"]:not([aria-hidden="true"]), .artdeco-modal')) {
          for (const btn of dlg.querySelectorAll('button:not([disabled]), input[type="submit"]:not([disabled])')) {
            const label = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim();
            if (re.test(label)) { btn.click(); return label; }
          }
        }
        return null;
      }, SEND_RE.source).catch(() => null);
      if (jsClicked) {
        await SLEEP(3000);
        const pendingNow = await mainCol(page, /^pending$/i);
        const bodyAfter = await page.locator('main').innerText().catch(() => '');
        if (pendingNow || /pending|invitation sent/i.test(bodyAfter.slice(0, 1000))) {
          await page.close();
          return { ok: true, result: 'connected_no_note', detail: `invite sent via JS click on "${jsClicked}"` };
        }
      }

      await encounter('connect', 'send button not found in invite dialog', { url: profileUrl, page });
      await page.close(); return { ok: false, result: 'error', detail: 'send button not found in invite dialog' };
    }
    await send.scrollIntoViewIfNeeded().catch(() => {});
    let sent = await send.click({ timeout: 5000 }).then(() => true).catch(() => false);
    if (!sent) sent = await send.click({ force: true, timeout: 3000 }).then(() => true).catch(() => false);
    if (!sent) await send.evaluate(el => el.click()).catch(() => {});
    // Wait up to 3000 ms for the dialog to close and the pending state to appear.
    await SLEEP(3000);
    const txt = await page.locator('body').innerText().catch(() => '');
    if (/weekly invitation limit|reached the weekly|you.?ve reached/i.test(txt)) { await page.close(); return { ok: false, result: 'limit', detail: 'LinkedIn weekly invitation limit reached' }; }
    // Check dialog-gone as an additional confirmation signal.
    const dialogClosed = (await page.locator('[data-test-modal-id]').count().catch(() => 1)) === 0;
    const pending = !!(await mainCol(page, /^pending$/i)) || /invitation sent|pending/i.test(txt.slice(0, 3000)) || dialogClosed;
    await page.close();
    return pending
      ? { ok: true, result: usedNote ? 'connected' : 'connected_no_note', detail: usedNote ? 'invite + note sent' : 'invite sent (note quota likely exhausted)', note: usedNote ? note : '' }
      : { ok: false, result: 'error', detail: 'no Pending state after send' };
  } catch (e) {
    await encounter('connect', 'exception: ' + e.message.split('\n')[0], { url: profileUrl, page }).catch(() => {});
    await page.close().catch(() => {});
    return { ok: false, result: 'error', detail: e.message.slice(0, 160) };
  }
}
