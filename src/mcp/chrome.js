// src/mcp/chrome.js — Chrome launcher, the PROVEN LEGACY WAY.
// Launches a SEPARATE Chrome instance on a dedicated data dir + debug port.
// It NEVER touches your day-to-day Chrome — both run side by side.
// You log into LinkedIn and Gmail in this debug Chrome once.
// Indeed and Glassdoor do not get a login form while this debug port is open.
// Those two use openManualLoginWindow(): a normal window, Glassdoor with Google
// first, then Indeed. This file does not solve a check or change the fingerprint.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..', '..');

// Dedicated debug profile — separate from your real Chrome, lives with the app.
export const DEBUG_PROFILE_DIR = path.join(ROOT, 'data', 'chrome-debug-profile');

// Cross-process launch lock. Multiple callers (the MCP server's getBrowser self-heal, the
// worker's startup launch, the agent's manual launch_chrome) can all decide Chrome is down at
// the SAME moment. Without a lock each spawns its own chrome.exe on the SAME user-data-dir;
// Chrome's single-instance logic then has the newcomers hand off to one instance and exit — the
// browser visibly opens and closes, the debug port flaps, and in the worst case the retries pile
// into a spawn storm that exhausts memory and crashes the host process. The lock makes exactly
// one launcher spawn Chrome while the others wait and attach.
const LOCK_FILE = path.join(DEBUG_PROFILE_DIR, '.launch.lock');
const LOCK_STALE_MS = 45000;

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
];
function findChrome() { return CHROME_PATHS.find(p => fs.existsSync(p)) || null; }

function portOpen(port = 9222, host = '127.0.0.1', timeout = 1000) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(timeout);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
    s.connect(port, host);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Acquire the launch lock atomically. Returns true if WE now own it. */
function acquireLock() {
  try { fs.mkdirSync(DEBUG_PROFILE_DIR, { recursive: true }); } catch {}
  try {
    fs.writeFileSync(LOCK_FILE, String(Date.now()), { flag: 'wx' }); // wx = fail if exists
    return true;
  } catch {
    // Someone holds it. Steal only if it is clearly stale (holder died mid-launch).
    try {
      const ts = Number(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (!ts || Date.now() - ts > LOCK_STALE_MS) { fs.writeFileSync(LOCK_FILE, String(Date.now())); return true; }
    } catch {}
    return false;
  }
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch {} }

/**
 * Clear the "did not exit cleanly" crash state in the dedicated debug profile.
 * When Chrome is killed (which is how every relaunch here ends the old instance) it leaves
 * exit_type="Crashed"/exited_cleanly=false behind. On the next start Chrome comes up in a
 * degraded restore state where CDP's Target.createTarget ("open a new tab") fails — the attach
 * then errors, the caller thinks Chrome is down and relaunches, which crashes it again: a
 * self-sustaining flap. Repairing the flags (plus removing stale Singleton* locks) makes Chrome
 * start healthy.
 */
function repairProfileState() {
  try {
    for (const name of fs.readdirSync(DEBUG_PROFILE_DIR)) {
      if (name.startsWith('Singleton')) { try { fs.unlinkSync(path.join(DEBUG_PROFILE_DIR, name)); } catch {} }
    }
  } catch {}
  const pref = path.join(DEBUG_PROFILE_DIR, 'Default', 'Preferences');
  try {
    if (fs.existsSync(pref)) {
      const raw = fs.readFileSync(pref, 'utf8');
      const fixed = raw
        .replace(/"exit_type":"[^"]*"/g, '"exit_type":"Normal"')
        .replace(/"exited_cleanly":false/g, '"exited_cleanly":true');
      if (fixed !== raw) fs.writeFileSync(pref, fixed);
    }
  } catch {}
}

/**
 * Ensure a debug Chrome is up on :9222 using the dedicated profile dir.
 * If the port is already up → attach, touch nothing.
 * Else → launch a SEPARATE Chrome on data/chrome-debug-profile. Your real Chrome is never closed
 * or affected. Launches are serialized by a lock so concurrent callers never spawn competing
 * instances (the open/close flap).
 */
export async function launchChrome() {
  if (await portOpen()) {
    return { ok: true, state: 'already_up', detail: 'Debug Chrome already on :9222 — attached, nothing else touched' };
  }

  const chrome = findChrome();
  if (!chrome) return { ok: false, state: 'no_chrome', detail: 'Chrome not found. Public-API scraping still works; logged-in sites need Chrome.' };

  // Serialize: only one launcher spawns Chrome at a time. If we lose the race for the lock,
  // another launcher is already bringing Chrome up — wait for the port and attach instead of
  // spawning a competing (and conflicting) instance.
  if (!acquireLock()) {
    for (let i = 0; i < 40; i++) {        // up to ~30s
      await sleep(750);
      if (await portOpen()) {
        return { ok: true, state: 'already_up', detail: 'Debug Chrome brought up by a concurrent launcher — attached' };
      }
    }
    return { ok: false, state: 'timeout', detail: 'Another launcher held the lock but Chrome did not come up — call launch_chrome again' };
  }

  try {
    // Re-check under the lock: a launcher that finished just before us may already have brought
    // Chrome up.
    if (await portOpen()) {
      return { ok: true, state: 'already_up', detail: 'Debug Chrome already on :9222 — attached, nothing else touched' };
    }

    fs.mkdirSync(DEBUG_PROFILE_DIR, { recursive: true });
    const firstRun = !fs.existsSync(path.join(DEBUG_PROFILE_DIR, 'Default'));

    // Heal the profile BEFORE launching so Chrome starts clean and CDP can create tabs (otherwise
    // the attach fails and triggers a relaunch loop).
    repairProfileState();

    // Separate instance, separate data dir, debug port. Does NOT touch your Chrome.
    const child = spawn(chrome, [
      '--remote-debugging-port=9222',
      `--user-data-dir=${DEBUG_PROFILE_DIR}`,
      '--no-first-run', '--no-default-browser-check',
      '--no-service-autorun', '--disable-sync',
      '--restore-last-session=false',
      // Keep every tab live. A discarded/frozen tab (Memory Saver, occlusion/background
      // throttling) makes Chrome 155 stall the browser-level CDP WebSocket handshake, so
      // connectOverCDP() hangs until timeout and NOTHING can drive the browser. Disabling
      // tab discarding + backgrounding keeps the CDP endpoint responsive. See Playwright #41714.
      '--disable-features=CalculateNativeWinOcclusion,HighEfficiencyModeAvailable,MemorySaver',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ], { detached: true, stdio: 'ignore' });
    child.unref();

    for (let i = 0; i < 25; i++) {
      if (await portOpen()) {
        // Give Chrome a beat to finish binding the CDP HTTP endpoint and open its first page, so
        // the immediate next attach does not race startup.
        await sleep(1200);
        return {
          ok: true,
          state: firstRun ? 'launched_fresh' : 'launched',
          firstRun,
          detail: firstRun
            ? 'Opened a dedicated debug Chrome (separate from your normal Chrome). FIRST RUN — sign into LinkedIn and Gmail in THIS window. For Glassdoor and Indeed, close this debug window and use the dashboard sign-in card: Glassdoor with Google first, then Indeed.'
            : 'Opened the dedicated debug Chrome. LinkedIn and Gmail logins persist here. Glassdoor and Indeed sign-in is a normal window on this same profile: Glassdoor with Google first, then Indeed. Your normal Chrome is untouched.',
        };
      }
      await sleep(1000);
    }
    return { ok: false, state: 'timeout', detail: 'Launched debug Chrome but port 9222 did not bind in 25s — call launch_chrome again' };
  } finally {
    releaseLock();
  }
}

// Glassdoor's own login page, opened with no remote-debugging port. Indeed is
// opened by the person only after this Google sign-in. Opening Indeed first
// sticks on a check that has no form.
export const GLASSDOOR_LOGIN_URL = 'https://www.glassdoor.com/profile/login_input.htm';

/**
 * Open the JobPilot profile as a normal Chrome window so a person can sign in
 * to Glassdoor with Google, then Indeed with that same Google account.
 * Refuses while port 9222 is open: a driven window does not show the form.
 */
export async function openManualLoginWindow() {
  if (await portOpen()) {
    return {
      ok: false,
      state: 'debugger_attached',
      detail: 'The debug port is still open, so this profile is being driven. Stop the worker and close the JobPilot debug window, then try again.',
    };
  }
  const chrome = findChrome();
  if (!chrome) return { ok: false, state: 'no_chrome', detail: 'Chrome not found.' };
  const child = spawn(chrome, [
    `--user-data-dir=${DEBUG_PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    GLASSDOOR_LOGIN_URL,
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  return {
    ok: true,
    state: 'opened',
    url: GLASSDOOR_LOGIN_URL,
    detail: 'Opened Glassdoor in the JobPilot profile with no debug port. Sign in with Google. Then sign in to Indeed with that same Google account. Opening Indeed first sticks on a check with no form.',
  };
}
