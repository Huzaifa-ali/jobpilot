// TEMP probe 6 — map each DISTINCT activity urn → its actor by parsing the SDUI update records.
// Strategy: find "*elements" update entries; each has an entityUrn with the activity id AND an
// actor block with the company/member urn + name. Delete after.
import { getContext } from '../src/agent/browser.js';

const q = process.argv[2] || 'hiring Pakistan software engineer';
const ctx = await getContext();
const page = await ctx.newPage();

let raw = '';
page.on('response', async resp => {
  try {
    if (!/\/search\/results\/content/.test(resp.url())) return;
    const body = await resp.text().catch(() => '');
    if (/urn:li:activity:\d+/.test(body) && body.length > raw.length) raw = body;
  } catch {}
});
const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}&sortBy=%22date_posted%22&datePosted=%22past-24h%22`;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
await new Promise(r => setTimeout(r, 4000));
for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 2500); await new Promise(r => setTimeout(r, 1000)); }

// For each fsd_update entityUrn that wraps an activity, capture the actor name that appears
// closest AFTER it. fsd_update entityUrn form: urn:li:fsd_update:(urn:li:activity:ID,...)
const re = /urn:li:fsd_update:\(urn:li:activity:(\d+),/g; let m; const out = [];
const seen = new Set();
while ((m = re.exec(raw))) {
  if (seen.has(m[1])) continue; seen.add(m[1]);
  const win = raw.slice(m.index, m.index + 4000);
  const actorName = (win.match(/"actorNavigationContext"[\s\S]{0,400}?"accessibilityText"\s*:\s*"([^"]{3,60})"/) ||
                     win.match(/"title"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{3,60})"/) ||
                     win.match(/"name"\s*:\s*"([^"]{3,60})"/) || [])[1] || '';
  out.push({ urn: m[1], actorName });
}
console.log('distinct fsd_update activities (first-appearance order):');
console.log(JSON.stringify(out.slice(0, 8), null, 2));

const dom = await page.evaluate(() => [...document.querySelectorAll('div[componentkey*="FeedType"]')]
  .filter(p => !p.parentElement.closest('div[componentkey*="FeedType"]'))
  .map(p => (p.innerText||'').replace(/\s+/g,' ').replace(/^Feed post /,'').slice(0,40)));
console.log('DOM order:', JSON.stringify(dom, null, 2));
await page.close();
process.exit(0);
