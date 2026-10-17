// Path traces from docs/paths/<site>/path.md, drawn as one hop per row.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { esc } from '../helpers.js';

const PATHS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/paths');

function kind(result) {
  const r = String(result || '').toLowerCase();
  if (r.startsWith('success')) return 'ok';
  if (r.includes('stop') || r.includes('refused')) return 'stop';
  if (r.includes('retry')) return 'wait';
  return 'go';
}

/** @param {string} [dir] */
export function readPathTraces(dir = PATHS) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
    const file = path.join(dir, d.name, 'path.md');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const hops = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map(s => s.trim().replace(/`/g, ''));
      if (cells.length < 4 || cells[0] === 'From' || /^[-:]+$/.test(cells[0])) continue;
      hops.push({ from: cells[0], option: cells[1], to: cells[2], result: cells[3] });
    }
    const intro = text.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#') && !l.startsWith('|')) || '';
    return { site: d.name, intro, hops };
  });
}

/** @param {{site:string, intro:string, hops:object[]}[]} traces */
export function renderPathsTab(traces) {
  if (!traces.length) return '<p class="dim">No path traces in docs/paths yet.</p>';
  return traces.map(t => `<h2>${esc(t.site)}</h2><p class="dim">${esc(t.intro)}</p><div class="trace">${
    t.hops.map(h => `<div class="hop hop-${kind(h.result)}"><b>${esc(h.from)}</b><span>${esc(h.option)}</span><em>${esc(h.to)}</em><i>${esc(h.result)}</i></div>`).join('<div class="hop-next">↓</div>')
  }</div>`).join('');
}
