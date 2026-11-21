// L5 Ear challenges: the app plays a hidden target sound on a small patch;
// the learner turns the knobs until their sound matches, then taps Check.
// Closeness is measured on the knobs (in knob travel), the matching is done by ear.
import { EXAMPLES } from './patches.js';
import { markAbbr, abbrIn, legendHtml } from './abbr.js';

const pickOne = a => a[Math.floor(Math.random() * a.length)];

// Each challenge: a base Example Patch, the knobs to match, and how to choose a target.
export const CHALLENGES = [
  { id: 'cutoff', name: 'Bright or dark?', base: 0, params: [['vcf', 'cutoff']],
    intro: 'Only the VCF Cutoff of the target is different. Is it brighter or darker than yours?',
    target: () => ({ vcf: { cutoff: pickOne([250, 450, 900, 2000, 5000]) } }) },
  { id: 'wave', name: 'Which wave?', base: 0, params: [['vco', 'wave']],
    intro: 'The target uses a different waveform on the VCO. Listen: pure and soft, hollow, or bright and buzzy?',
    setup: { vcf: { cutoff: 8000 } },
    target: () => ({ vco: { wave: pickOne(['sine', 'triangle', 'square']) } }) },
  { id: 'octave', name: 'How high?', base: 0, params: [['vco', 'tune']],
    intro: 'The target plays the same key, but the VCO sits in another octave. Find it with the Octave knob.',
    target: () => ({ vco: { tune: pickOne([-2, -1, 1, 2]) } }) },
  { id: 'shape', name: 'Pluck or pad?', base: 0, params: [['env', 'a'], ['env', 'd'], ['env', 's'], ['env', 'r']],
    intro: 'The target note has a different shape in time. Does it start softly or at once? Does it hold or die away? How long does it ring after the key?',
    target: () => ({ env: pickOne([
      { a: 0.002, d: 0.25, s: 0, r: 0.2 },    // pluck
      { a: 0.002, d: 0.1, s: 1, r: 0.05 },    // organ
      { a: 0.8, d: 0.5, s: 0.8, r: 1.5 },     // pad
      { a: 0.05, d: 1.2, s: 0.2, r: 0.6 }     // piano-like
    ]) }) },
  { id: 'squelch', name: 'Squelch', base: 0, params: [['vcf', 'cutoff'], ['vcf', 'res']],
    intro: 'Cutoff and Resonance of the target are different. Resonance is the whistle at the cutoff.',
    target: () => ({ vcf: { cutoff: pickOne([400, 800, 1600]), res: pickOne([0.1, 0.5, 0.85]) } }) },
  { id: 'wobble', name: 'Wobble', base: 1, params: [['lfo', 'rate'], ['lfo', 'depth']],
    intro: 'An LFO wobbles the pitch. How fast (Rate) and how wide (Depth) is the target\'s wobble?',
    setup: { lfo: { rate: 2, depth: 0.2 } },
    target: () => ({ lfo: { rate: pickOne([0.8, 3, 7]), depth: pickOne([0.05, 0.3, 0.7]) } }) }
];

export function initEar(api) {
  const { S, MODULES, $, esc } = api;
  const panel = $('#guide');
  let E = null; // { ch, target, tries, playing }

  const mod = id => api.modById(id);
  const ctl = (m, p) => MODULES[m.type].controls.find(c => c.id === p);
  // how far a knob is from the target, as a part of its travel (0 = exact, 1 = opposite end)
  const dist = (m, p, v) => {
    const c = ctl(m, p);
    if (c.type === 'select') return m.params[p] === v ? 0 : 1;
    return Math.abs(api.toNorm(c, m.params[p]) - api.toNorm(c, v));
  };

  function start(ch) {
    api.beforePanel && api.beforePanel();
    api.loadPatch(EXAMPLES[ch.base]);
    for (const [id, ps] of Object.entries(ch.setup || {})) for (const [p, v] of Object.entries(ps)) api.setParam(mod(id), p, v);
    let target;
    do { target = ch.target(); } // never a target that is already matched
    while (ch.params.every(([id, p]) => dist(mod(id), p, target[id][p]) < 0.05));
    E = { ch, target, tries: 0, msg: '' };
    document.body.classList.add('guiding');
    render();
  }

  function render() {
    const ch = E.ch, i = CHALLENGES.indexOf(ch);
    panel.hidden = false; panel.classList.remove('folded');
    const knobs = ch.params.map(([id, p]) => `${mod(id).name} ${ctl(mod(id), p).full || ctl(mod(id), p).label}`).join(', ');
    panel.innerHTML = `
      <div class="g-top"><span class="g-count">Ear challenge ${i + 1} of ${CHALLENGES.length} · ${esc(ch.name)}</span><button id="earExit" class="winbtn" aria-label="Close the challenge">✕</button></div>
      <div class="g-body">
      <p class="g-text">${markAbbr(ch.intro)}</p>
      <p class="g-why"><b>Knobs to match:</b> ${markAbbr(knobs)}. Listen to the target, then to yours, and turn the knobs.</p>
      ${E.msg ? `<p class="ear-msg${E.solved ? ' ok' : ''}">${E.msg}</p>` : ''}
      ${legendHtml(abbrIn(ch.intro, knobs), true)}
      </div>
      <div class="g-actions">
        <button id="earTarget" class="btn">▶ Target</button><button id="earMine" class="btn">▶ Mine</button>
        ${E.solved ? '<button id="earNext" class="btn primary">Next challenge</button>' : '<button id="earCheck" class="btn primary">Check</button>'}
        ${!E.solved && E.tries >= 2 ? '<button id="earShow" class="btn">Show answer</button>' : ''}
      </div>`;
    $('#earExit').onclick = stop;
    $('#earTarget').onclick = () => play(true);
    $('#earMine').onclick = () => play(false);
    const ck = $('#earCheck'); if (ck) ck.onclick = check;
    const nx = $('#earNext'); if (nx) nx.onclick = () => start(CHALLENGES[(i + 1) % CHALLENGES.length]);
    const sh = $('#earShow'); if (sh) sh.onclick = showAnswer;
    requestAnimationFrame(api.layout);
  }

  // play one note; for the target, the hidden values are swapped in for that note only
  // (knobs and displays do not move, so nothing gives the answer away)
  function play(target) {
    if (E.playing) return;
    const kb = S.modules.find(m => m.type === 'keyboard'); if (!kb) return;
    const saved = [];
    if (target) {
      S.earHide = true;
      for (const [id, ps] of Object.entries(E.target)) for (const [p, v] of Object.entries(ps)) {
        const m = mod(id); saved.push([m, p, m.params[p]]); m.params[p] = v; m.inst.set(p, v); api.voices.set(m, p, v);
      }
    }
    E.playing = true;
    const hold = 1.2, note = 48;
    kb.inst.noteOn(note);
    setTimeout(() => kb.inst.noteOff(note), hold * 1000);
    setTimeout(() => {
      for (const [m, p, v] of saved) { m.params[p] = v; m.inst.set(p, v); api.voices.set(m, p, v); }
      S.earHide = false; if (E) E.playing = false;
    }, (hold + (target ? releaseOf() : 0.2)) * 1000);
  }
  const releaseOf = () => { const r = E.target.env && E.target.env.r; return Math.min(2, (r || 0.4) + 0.3); };

  function check() {
    E.tries++;
    const ds = E.ch.params.map(([id, p]) => ({ id, p, d: dist(mod(id), p, E.target[id][p]) }));
    const worst = ds.reduce((a, b) => (b.d > a.d ? b : a));
    const score = Math.round(100 * Math.max(0, 1 - ds.reduce((a, b) => a + b.d, 0) / ds.length / 0.5));
    if (worst.d <= 0.06) {
      E.solved = true;
      E.msg = `✓ Match! ${E.tries === 1 ? 'First try.' : `Solved in ${E.tries} tries.`} Play both again to hear that they sound the same.`;
    } else {
      const m = mod(worst.id), c = ctl(m, worst.p), t = E.target[worst.id][worst.p];
      const dir = c.type === 'select' ? 'is set differently' : api.toNorm(c, m.params[worst.p]) > api.toNorm(c, t) ? 'is too high' : 'is too low';
      E.msg = `${score}% there.${E.tries >= 2 ? ` Hint: ${esc(m.name)} ${esc(c.full || c.label)} ${dir}.` : ' Listen again and keep turning.'}`;
    }
    render();
  }
  function showAnswer() {
    for (const [id, ps] of Object.entries(E.target)) for (const [p, v] of Object.entries(ps)) api.setParam(mod(id), p, v);
    E.solved = true; E.msg = 'This is the target. Play it, then try the next challenge.';
    render();
  }

  function stop() {
    if (!E) return;
    E = null; S.earHide = false;
    panel.hidden = true; panel.innerHTML = '';
    document.body.classList.remove('guiding');
    requestAnimationFrame(api.layout);
  }

  function chooser() {
    api.openSheet(`<h2>Ear challenges</h2>
      <p class="hint">The app plays a hidden target sound. Turn the knobs it names until your sound matches, then tap Check. Each challenge loads a small patch; it replaces what is in your rack (↶ undoes it).</p>
      <div class="plist">${CHALLENGES.map((c, i) => `<button class="pitem" data-e="${i}"><b>${esc(c.name)}</b><span>${markAbbr(c.intro)}</span></button>`).join('')}</div>`);
    $('#sheetBody').onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; api.closeSheet(); start(CHALLENGES[+b.dataset.e]); };
  }

  return { chooser, start, stop, active: () => !!E, state: () => E };
}
