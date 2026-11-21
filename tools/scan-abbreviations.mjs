// Lists every abbreviation used in module and guide texts, and flags those missing from js/abbr.js.
// Usage: node tools/scan-abbreviations.mjs
const root = new URL('..', import.meta.url);
const { MODULES } = await import(new URL('js/modules.js', root));
const { GUIDES, CONCEPTS } = await import(new URL('js/guides.js', root));
const { ABBR, NOT_ABBR } = await import(new URL('js/abbr.js', root));
const { LIBRARY } = await import(new URL('js/library.js', root));

const texts = [];
for (const [k, d] of Object.entries(MODULES)) {
  texts.push([k, d.name], [k, d.info.title], [k, d.info.text], [k, d.info.tryThis]);
  for (const c of d.controls) texts.push([k, c.label], [k, c.info]);
  for (const j of [...d.inputs, ...d.outputs]) texts.push([k, j.label], [k, j.info]);
}
for (const g of GUIDES) {
  texts.push(['guide:' + g.id, g.description]);
  for (const s of g.steps) texts.push(['guide:' + g.id, s.title], ['guide:' + g.id, s.text], ['guide:' + g.id, s.why]);
}
for (const [k, [n, t]] of Object.entries(CONCEPTS)) texts.push(['concept:' + k, n], ['concept:' + k, t]);
for (const e of LIBRARY) for (const t of [e.title, e.artist, ...e.goals, ...e.history, ...e.gear, ...e.facts, ...e.inApp, ...e.tutorial.map(x => x.text)]) texts.push(['library:' + e.id, t]);
for (const e of LIBRARY) if (e.patch) for (const mods of Object.values(e.patch.meta.params)) for (const v of Object.values(mods)) if (v.note) texts.push(['library-notes:' + e.id, v.note]);
// known multi-part names (e.g. "CS-80", "ARP 2600") are taken out first, so their parts are not flagged
const known = Object.keys(ABBR).sort((a, b) => b.length - a.length);
const escRe = k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const knownRe = known.map(k => new RegExp(`(?<![A-Za-z0-9])${escRe(k)}(?![A-Za-z0-9])`, 'g'));
const strip = t => knownRe.reduce((s, r) => s.replace(r, ' '), String(t || ''));
const re = /\b(?:[A-Z]{2,}[0-9]*|R&B|[A-Z]+[0-9]+[A-Z]*|kHz|Hz|ms|Amt|Reso)\b/g;
const found = {};
for (const [where, t] of texts) known.forEach((k, i) => { knownRe[i].lastIndex = 0; if (knownRe[i].test(String(t || ''))) (found[k] ||= new Set()).add(where); });
for (const [where, t] of texts) for (const m of strip(t).matchAll(re)) if (!NOT_ABBR.has(m[0])) (found[m[0]] ||= new Set()).add(where);
let missing = 0;
for (const [k, v] of Object.entries(found).sort()) {
  const ok = k in ABBR;
  if (!ok) missing++;
  console.log((ok ? '  ok ' : 'MISS ') + k.padEnd(8) + [...v].join(', '));
}
console.log(missing ? `\n${missing} abbreviation(s) have no explanation in js/abbr.js` : '\nAll abbreviations are explained.');
process.exitCode = missing ? 1 : 0;
