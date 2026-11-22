// Static check of every Guided Build, without a browser: node tools/check-guides.mjs
// It replays the steps on a model of the rack and reports what a learner would trip over:
// unknown modules, jacks or controls; goals no knob position can reach; goals already met before
// the step (the step would tick itself off); cables that silently replace an earlier cable;
// "play" steps with nothing to play; controls on the More page the text does not mention;
// chapter titles that match no step; old UI words (⋯, Exit, Hide). It also counts knob steps that
// come before the module is cabled to the Output (the guide skips 'Hear the difference' there).
import { MODULES, defaultParams, patchParams } from '../js/modules.js';
import { EXAMPLES } from '../js/patches.js';
import { GUIDES, CONCEPTS } from '../js/guides.js';

const fromNorm = (c, n) => {
  let v = c.curve === 'exp' ? (c.min > 0 ? c.min * Math.pow(c.max / c.min, n) : c.min + (c.max - c.min) * n ** 3) : c.min + (c.max - c.min) * n;
  if (c.step) v = Math.round(v / c.step) * c.step;
  return Math.max(c.min, Math.min(c.max, v));
};
const candidates = c => c.type === 'select' ? c.options : c.type === 'toggle' ? [0, 1] : Array.from({ length: 201 }, (_, k) => fromNorm(c, k / 200));
const OLD_UI = [/⋯/, /\bExit\b/, /\bHide\b/, /tap (its|the module'?s?) name to (move|remove)/i];

let problems = 0, notes = 0, silentSets = 0;
for (const [gi, g] of GUIDES.entries()) {
  const out = [];
  const warn = (i, msg) => { out.push(`  step ${i + 1}: ${msg}`); problems++; };
  const note = (i, msg) => { out.push(`  step ${i + 1}: (note) ${msg}`); notes++; };
  // rack model: alias -> { type, params }, cables: [{from:[a,j], to:[a,j]}]
  const rack = {}, cables = [], moreOpen = new Set();
  if (g.base != null) {
    const p = EXAMPLES[g.base];
    for (const m of p.modules) rack[m.id] = { type: m.type, params: patchParams(m.type, m.params || {}) };
    for (const c of p.cables) cables.push({ from: [c.from.module, c.from.jack], to: [c.to.module, c.to.jack] });
  }
  const has = t => Object.values(rack).some(m => m.type === t);
  for (const [k, list] of [['concepts', g.concepts || []]]) for (const c of list) if (!CONCEPTS[c]) warn(-1, `unknown concept "${c}"`);
  for (const [name, title] of g.chapters || []) if (!g.steps.some(s => s.title === title)) warn(-1, `chapter "${name}" starts at "${title}", but no step has that title`);
  g.steps.forEach((s, i) => {
    const words = `${s.title} ${s.text} ${s.why}`;
    for (const re of OLD_UI) if (re.test(words)) warn(i, `old UI word ${re} in "${s.title}"`);
    if (!s.text || !s.why) warn(i, 'text or why is empty');
    if (s.do === 'add') {
      if (!MODULES[s.type]) return warn(i, `unknown module type ${s.type}`);
      if (rack[s.as]) warn(i, `alias ${s.as} used twice`);
      rack[s.as] = { type: s.type, params: defaultParams(s.type) };
    } else if (s.do === 'cable') {
      const [fa, fj] = s.from, [ta, tj] = s.to, f = rack[fa], t = rack[ta];
      if (!f || !t) return warn(i, `cable uses a module that is not there yet (${fa} → ${ta})`);
      const o = MODULES[f.type].outputs.find(j => j.id === fj), n = MODULES[t.type].inputs.find(j => j.id === tj);
      if (!o) return warn(i, `${f.type} has no output "${fj}"`);
      if (!n) return warn(i, `${t.type} has no input "${tj}"`);
      if (o.kind !== n.kind) warn(i, `jack kinds differ: ${f.type}.${fj} (${o.kind}) → ${t.type}.${tj} (${n.kind})`);
      const old = cables.find(c => c.to[0] === ta && c.to[1] === tj);
      if (old && !(old.from[0] === fa && old.from[1] === fj)) note(i, `replaces the cable ${old.from.join('.')} → ${ta}.${tj} (every input takes one cable)`);
      if (old && old.from[0] === fa && old.from[1] === fj) warn(i, `cable ${fa}.${fj} → ${ta}.${tj} is already there: the step ticks itself off`);
      if (old) cables.splice(cables.indexOf(old), 1);
      cables.push({ from: [fa, fj], to: [ta, tj] });
    } else if (s.do === 'set') {
      const m = rack[s.mod]; if (!m) return warn(i, `set on missing module ${s.mod}`);
      const c = MODULES[m.type].controls.find(x => x.id === s.param);
      if (!c) return warn(i, `${m.type} has no control "${s.param}"`);
      const ok = candidates(c).filter(v => s.test(v));
      if (!ok.length) return warn(i, `no position of ${m.type}.${s.param} passes the test`);
      const cur = m.params[s.param];
      if (s.test(cur)) warn(i, `${m.type}.${s.param} already passes (${cur}): the step ticks itself off at once`);
      // the learner (or "Do it for me") ends close to the current value, a few steps inside the goal
      const v = typeof cur === 'number' ? [...ok].sort((x, y) => Math.abs(x - cur) - Math.abs(y - cur))[Math.min(3, ok.length - 1)] : ok[0];
      m.params[s.param] = v;
      // the guide only offers 'Hear the difference' when cables lead from the module to the Output
      const seen = new Set([s.mod]), q = [s.mod]; let heard = false;
      while (q.length) { const x = q.shift(); if (rack[x].type === 'output') { heard = true; break; } for (const cb of cables) if (cb.from[0] === x && !seen.has(cb.to[0])) { seen.add(cb.to[0]); q.push(cb.to[0]); } }
      if (!heard && c.type !== 'toggle') silentSets++;
      const label = (c.full || c.label || '').toLowerCase(), short = (c.label || '').toLowerCase();
      const txt = words.toLowerCase();
      // the More page stays open once a step has sent the learner there
      if (c.expert && /\bmore\b/i.test(words)) moreOpen.add(s.mod);
      if (c.expert && !moreOpen.has(s.mod)) warn(i, `${m.type}.${s.param} is on the More page, but the step does not say so`);
      if (!c.stepGate && !txt.includes(label) && !txt.includes(short) && !txt.includes(s.param.toLowerCase())) note(i, `text does not name the control (${c.label}${c.full ? ' / ' + c.full : ''})`);
    } else if (s.do === 'play') {
      if (!has('keyboard') && !has('arp')) warn(i, 'play step, but there is no Keyboard or Arp: the keys do nothing');
    } else if (s.do !== 'next') warn(i, `unknown step kind ${s.do}`);
  });
  console.log(`${gi} ${g.id} (${g.steps.length} steps)${out.length ? '' : ' ok'}`);
  out.forEach(l => console.log(l));
}
console.log(`\n${silentSets} knob step(s) come before the module is cabled to the Output: no before/after comparison there`);
console.log(`${problems} problem(s), ${notes} note(s)`);
process.exitCode = problems ? 1 : 0;
