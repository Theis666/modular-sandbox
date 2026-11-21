// Renders a patch without the speaker (OfflineAudioContext), with the same modules,
// cables and polyphony as the rack. Used by the sound regression tests (M0-2) and
// the CPU guard (M0-3).
import { engine, loadWorklet } from './engine.js';
import { MODULES, patchParams } from './modules.js';
import { initVoices } from './voices.js';

export async function renderPatch(patch, { seconds = 2, notes = [48], hold = 1, sampleRate = 44100, timed = true } = {}) {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * sampleRate), sampleRate);
  if (engine.ctx && engine.ctx.__mssWorklet) await loadWorklet(ctx); // same engine as the rack
  const bus = ctx.createGain(); bus.connect(ctx.destination);
  const S = { modules: [], cables: [] };
  const modById = id => S.modules.find(m => m.id === id);
  const hooks = { step() {}, rec() {} };
  const master = engine.master; engine.master = bus; // the Output module connects to engine.master
  try {
    for (const pm of patch.modules) {
      const def = MODULES[pm.type]; if (!def) continue;
      const params = patchParams(pm.type, pm.params || {});
      def.controls.filter(c => c.transient).forEach(c => params[c.id] = c.def);
      S.modules.push({ id: pm.id, type: pm.type, params, inst: def.create(ctx, params, hooks) });
    }
  } finally { engine.master = master; }
  for (const c of patch.cables || []) {
    const A = modById(c.from.module), B = modById(c.to.module); if (!A || !B) continue;
    const od = MODULES[A.type].outputs.find(o => o.id === c.from.jack); if (!od) continue;
    const src = A.inst.outputs[c.from.jack], dst = B.inst.inputs[c.to.jack]; if (!src || !dst) continue;
    S.cables.push({ from: c.from, to: c.to, kind: od.kind });
    if (od.kind === 'gate') src.listeners.add(dst); else src.connect(dst);
  }
  initVoices({ S, MODULES, engine: { ctx }, modById }).rebuild();
  const players = S.modules.filter(m => m.inst.noteOn);
  notes.forEach(n => players.forEach(k => k.inst.noteOn(n)));
  // Sequencer and Arp schedule from JS timers: pause the render every 0.1 s so they can keep up.
  let waits = 0;
  const steps = Math.floor(seconds / 0.1);
  for (let k = 1; k < steps; k++) {
    ctx.suspend(k * 0.1).then(() => {
      if (Math.abs(k * 0.1 - hold) < 0.05) notes.forEach(n => players.forEach(p => p.inst.noteOff(n)));
      if (timed) { waits += 30; setTimeout(() => ctx.resume(), 30); } else ctx.resume();
    });
  }
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const ms = performance.now() - t0 - waits;
  S.modules.forEach(m => { try { m.inst.destroy(); } catch (e) {} });
  return { buf, ms };
}

// Simple measures of a render: loudness (peak, RMS) and brightness (spectral centroid in Hz,
// the "centre of gravity" of the spectrum, averaged over the held part of the note).
export function analyse(buf) {
  const d = buf.getChannelData(0), n = d.length, sr = buf.sampleRate;
  let peak = 0, sum = 0;
  for (let i = 0; i < n; i++) { const v = d[i]; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  const N = 4096, num = [], den = [];
  for (let start = Math.round(0.15 * sr); start + N <= Math.min(n, sr); start += N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = d[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im);
    let a = 0, b = 0;
    for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); a += m * k * sr / N; b += m; }
    num.push(a); den.push(b);
  }
  const centroid = den.reduce((x, y) => x + y, 0) > 1e-9 ? num.reduce((x, y) => x + y, 0) / den.reduce((x, y) => x + y, 0) : 0;
  return { peak: +peak.toFixed(4), rms: +Math.sqrt(sum / n).toFixed(4), centroid: Math.round(centroid) };
}
// in-place radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, ai = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j + len / 2] = re[i + j] - ar; im[i + j + len / 2] = im[i + j] - ai;
        re[i + j] += ar; im[i + j] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
