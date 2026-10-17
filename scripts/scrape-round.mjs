// One-off scrape round: varied Pakistan-focused queries → relevant, non-skip leads with emails.
// Prints JSON lines the orchestrator consumes. Does NOT send anything.
import { liPosts } from '../src/mcp/sources.js';

const queries = process.argv.slice(2);
if (!queries.length) {
  console.error('usage: node scrape-round.mjs "query1" "query2" ...');
  process.exit(1);
}

const seen = new Set();
const out = [];
for (const q of queries) {
  try {
    const r = await liPosts(q, {});
    for (const lead of (r.leads || [])) {
      if (!lead.email) continue;
      if (lead.skip) continue;
      const key = (lead.email || '') + '|' + (lead.role || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        query: q,
        role: lead.role,
        company: lead.company,
        email: lead.email,
        url: lead.url,
        applyUrl: lead.applyUrl || '',
        postedRaw: lead.postedRaw,
        relevance: lead.relevance,
      });
    }
  } catch (e) {
    console.error('[round] query failed:', q, e.message);
  }
}
console.log('===LEADS_JSON_START===');
console.log(JSON.stringify(out, null, 2));
console.log('===LEADS_JSON_END===');
process.exit(0);
