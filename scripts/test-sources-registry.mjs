// scripts/test-sources-registry.mjs — the pluggable source registry is the single
// source of truth for platforms. apply-sources.js and mix.js derive from it.
import {
  SOURCES, applySourceIds, discoverySourceIds, mixDefaults, sourceById,
} from '../src/sources-registry.js';

let fail = 0;
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) fail++; };
const eqSet = (a, b) => a.length === b.length && [...a].every(x => b.includes(x));

// web_search is a first-class discovery source with a positive mix weight.
const ws = sourceById('web_search');
check('web_search registered', !!ws);
check('web_search is discovery', !!ws && (ws.kind === 'discovery' || ws.kind === 'both'));
check('web_search has positive mixWeight', !!ws && ws.mixWeight > 0);

// Legacy apply sources are still present (no behavior removed).
const apply = applySourceIds();
check('apply sources superset of legacy', ['linkedin', 'indeed', 'glassdoor'].every(s => apply.includes(s)));

// Every id is lowercase, unique, non-empty.
const ids = SOURCES.map(s => s.id);
check('all ids lowercase non-empty', ids.every(id => typeof id === 'string' && id.length > 0 && id === id.toLowerCase()));
check('all ids unique', new Set(ids).size === ids.length);

// Discovery set includes web_search and at least one real board.
const disc = discoverySourceIds();
check('discovery includes web_search', disc.includes('web_search'));
check('discovery non-empty', disc.length > 0);

// mixDefaults().sources totals 100 and weights web discovery > 0.
const md = mixDefaults();
check('mixDefaults has sources+actions', md && md.sources && md.actions);
const sTotal = Object.values(md.sources).reduce((a, b) => a + b, 0);
check('mixDefaults.sources totals 100', sTotal === 100);
check('mixDefaults web weight > 0', (md.sources.web || 0) > 0);
const aTotal = Object.values(md.actions).reduce((a, b) => a + b, 0);
check('mixDefaults.actions totals 100', aTotal === 100);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
