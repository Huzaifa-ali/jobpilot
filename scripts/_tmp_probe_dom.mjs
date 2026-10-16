// TEMP DOM probe 3 — search the WHOLE document (scripts/code included) for activity URNs,
// and inspect the post control-menu. Delete after.
import { getContext } from '../src/agent/browser.js';

const q = process.argv[2] || 'hiring Pakistan software engineer';
const ctx = await getContext();
const page = await ctx.newPage();
const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}&sortBy=%22date_posted%22&datePosted=%22past-24h%22`;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
await new Promise(r => setTimeout(r, 4000));
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 2500); await new Promise(r => setTimeout(r, 900)); }

const probe = await page.evaluate(() => {
  const docUrns = (document.documentElement.outerHTML.match(/urn:li:(?:activity|ugcPost|share|fsd_update):[\w,:()-]+/g) || []).slice(0, 10);
  // control menu buttons / aria-labels inside first post
  const posts = [...document.querySelectorAll('div[componentkey*="FeedType"]')].filter(p => !p.parentElement.closest('div[componentkey*="FeedType"]'));
  const p = posts[0];
  let menu = [], ariaLabels = [], dataChameleon = [];
  if (p) {
    menu = [...p.querySelectorAll('button, [role=button]')].map(b => (b.getAttribute('aria-label') || b.innerText || '').trim()).filter(Boolean).slice(0, 15);
    ariaLabels = [...p.querySelectorAll('[aria-label]')].map(n => n.getAttribute('aria-label')).filter(Boolean).slice(0, 20);
    dataChameleon = [...p.querySelectorAll('[data-chameleon-result-urn], [data-urn], [data-id], [data-entity-urn]')].map(n => n.outerHTML.slice(0,120)).slice(0,10);
  }
  return { docUrns, menu, ariaLabels, dataChameleon };
});
console.log(JSON.stringify(probe, null, 2));
await page.close();
process.exit(0);
