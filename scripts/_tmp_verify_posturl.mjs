// TEMP verification — prints postUrl wiring for the first few liPosts() leads. Delete after.
import { liPosts } from '../src/mcp/sources.js';

const q = process.argv[2] || 'hiring Pakistan software engineer';
const r = await liPosts(q, { maxScroll: 4 });
console.log('ok=', r.ok, 'detail=', r.detail, 'leads=', (r.leads || []).length);
for (const l of (r.leads || []).slice(0, 6)) {
  console.log(JSON.stringify({ role: l.role, channel: l.channel, posterUrl: l.posterUrl, postUrl: l.postUrl, url: l.url }));
}
process.exit(0);
