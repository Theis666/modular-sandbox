// Sound regression tests (ROADMAP M0-2). Renders every Example Patch and Classic sound
// without the speaker and compares loudness (peak, RMS) and brightness (spectral centroid) with tools/render-baseline.json.
// In the browser console of the running app:
//   const t = await import('/tools/render-tests.js'); await t.check()     // compare with the baseline
//   copy(JSON.stringify(await t.measure(), null, 1))                      // new baseline after an intended change
import { renderPatch, analyse } from '../js/offline.js';
import { EXAMPLES } from '../js/patches.js';
import { LIBRARY } from '../js/library.js';

export function cases() {
  const list = EXAMPLES.map(p => ({ id: 'example:' + p.name, patch: p, notes: [48] }));
  for (const e of LIBRARY) if (e.patch) {
    const kb = e.patch.modules.find(m => m.type === 'keyboard');
    const poly = kb && kb.params && kb.params.voices > 1;
    list.push({ id: 'library:' + e.id, patch: e.patch, notes: poly ? [48, 52, 55] : [48] });
  }
  // modules that no Example or Classic sound uses yet
  const mod = (id, type, params = {}) => ({ id, type, params });
  const cab = (fm, fj, tm, tj) => ({ from: { module: fm, jack: fj }, to: { module: tm, jack: tj } });
  list.push({ id: 'module:clap', notes: [48], patch: { format: 'modular-synth-sandbox', version: 1, name: 'Clap test',
    modules: [mod('kb', 'keyboard'), mod('noise', 'noise', { level: 1 }), mod('vcf', 'vcf', { type: 'bandpass', cutoff: 900, res: 0 }), mod('clap', 'clap'),
      mod('vca', 'vca'), mod('out', 'output')],
    cables: [cab('kb', 'gate', 'clap', 'gate'), cab('noise', 'out', 'vcf', 'in'), cab('vcf', 'out', 'vca', 'in'),
      cab('clap', 'out', 'vca', 'cv'), cab('vca', 'out', 'out', 'in')] } });
  return list;
}

export async function measure() {
  const out = {};
  for (const c of cases()) {
    // two seconds: one second held, one second of release and effects
    const { buf } = await renderPatch(JSON.parse(JSON.stringify(c.patch)), { seconds: 2, notes: c.notes, hold: 1 });
    out[c.id] = analyse(buf);
  }
  return out;
}

// Tolerances: random parts (noise, random LFO, reverb) make every render a little different.
const TOL = { peak: 0.2, rms: 0.15, centroid: 0.15 };
export async function check() {
  const base = await (await fetch('/tools/render-baseline.json', { cache: 'no-cache' })).json();
  const now = await measure(), report = [];
  for (const [id, m] of Object.entries(now)) {
    const b = base[id];
    if (!b) { report.push(`NEW  ${id} ${JSON.stringify(m)}`); continue; }
    const off = Object.keys(TOL).filter(k => Math.abs(m[k] - b[k]) > TOL[k] * Math.max(Math.abs(b[k]), k === 'centroid' ? 50 : 0.01));
    report.push(`${off.length ? 'DIFF' : 'ok  '} ${id}${off.length ? ' ' + off.map(k => `${k} ${b[k]} → ${m[k]}`).join(', ') : ''}`);
  }
  for (const id of Object.keys(base)) if (!(id in now)) report.push(`GONE ${id}`);
  return report;
}
