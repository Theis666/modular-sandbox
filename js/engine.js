// Audio engine helpers: shared context, gate events, envelopes, master bus.
export const engine = { ctx: null, master: null, out: null, ready: Promise.resolve(false) };

// M3 (ADR 0010): load the AudioWorklet processors (js/worklet.js) into a context. Modules check
// ctx.__mssWorklet and fall back to built-in nodes when the worklet is not available.
// The Artifact bundle has no files next to it, so it passes the source in window.__MSS_WORKLET.
export async function loadWorklet(ctx) {
  if (!ctx.audioWorklet) return false;
  try {
    const url = window.__MSS_WORKLET ? URL.createObjectURL(new Blob([window.__MSS_WORKLET], { type: 'text/javascript' })) : 'js/worklet.js';
    await ctx.audioWorklet.addModule(url);
    ctx.__mssWorklet = true;
  } catch (e) { ctx.__mssWorklet = false; }
  return ctx.__mssWorklet;
}

export function startAudio() {
  if (engine.ctx) return engine.ctx;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ latencyHint: 'interactive' });
  // Master bus: gentle limiter so patches can't blow your ears out.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 12;
  comp.attack.value = 0.003; comp.release.value = 0.15;
  const master = ctx.createGain(); master.gain.value = 0.9;
  // Soft clipper after the compressor: unchanged up to 0.8, then rounds off smoothly,
  // so the speaker and recordings never hard-clip. The shaper's curve covers -1..+1,
  // so the signal is halved going in and the curve maps it back to the real range (-2..+2).
  const pre = ctx.createGain(); pre.gain.value = 0.5;
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / 2048 - 1) * 2, ax = Math.abs(x);
    curve[i] = ax < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((ax - 0.8) / 0.2));
  }
  clip.curve = curve; clip.oversample = '2x';
  // `?mute` in the URL (for testing): everything runs and can be measured, nothing reaches the speaker
  const mute = ctx.createGain(); mute.gain.value = /[?&]mute\b/.test(location.search) ? 0 : 1;
  master.connect(comp).connect(pre).connect(clip).connect(mute).connect(ctx.destination);
  engine.ctx = ctx; engine.master = master; engine.out = clip;
  engine.ready = loadWorklet(ctx);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx.state !== 'running') ctx.resume();
  });
  return ctx;
}

// A gate output: an on/off event stream with timestamps (see ADR 0004).
export class GateOut {
  constructor() { this.listeners = new Set(); this.events = []; }
  emit(on, time) {
    this.events.push({ on, time });
    if (this.events.length > 16) this.events.shift();
    for (const fn of this.listeners) fn(on, time);
  }
  isOn(now) {
    let state = false;
    for (const e of this.events) if (e.time <= now) state = e.on;
    return state;
  }
}

// Envelope on an AudioParam, with our own bookkeeping of the current value
// so retriggers start from where the envelope really is.
export class Envelope {
  constructor(param) { this.p = param; this.pts = [{ t: 0, v: 0 }]; }
  valueAt(t) {
    const pts = this.pts;
    for (let i = pts.length - 1; i >= 0; i--) {
      if (pts[i].t <= t) {
        const a = pts[i], b = pts[i + 1];
        // exponential segment (setTargetAtTime): approaches its target, like a capacitor charging
        if (a.exp) return a.exp.target + (a.v - a.exp.target) * Math.exp(-(t - a.t) / a.exp.tau);
        if (!b) return a.v;
        return a.v + (b.v - a.v) * ((t - a.t) / Math.max(1e-6, b.t - a.t));
      }
    }
    return pts[0].v;
  }
  _restart(t) {
    const v = this.valueAt(t);
    const p = this.p;
    if (p.cancelAndHoldAtTime) { p.cancelAndHoldAtTime(t); }
    else { p.cancelScheduledValues(t); }
    p.setValueAtTime(v, t);
    this.pts = this.pts.filter(x => x.t < t);
    this.pts.push({ t, v });
    return v;
  }
  _ramp(v, t) { this.p.linearRampToValueAtTime(v, t); this.pts.push({ t, v }); }
  // exp = true: decay and release fall fast first, then slowly (analog style, ADR 0010).
  // The time constant is a quarter of the set time, so after Decay/Release the curve is 98% there.
  _target(v, t, time) { const tau = Math.max(0.001, time / 4); this.p.setTargetAtTime(v, t, tau); this.pts.push({ t, v: this.valueAt(t), exp: { target: v, tau } }); }
  attack(t, a, d, s, exp) {
    this._restart(t);
    this._ramp(1, t + a);
    if (exp) this._target(s, t + a, d); else this._ramp(s, t + a + d);
    if (this.pts.length > 12) this.pts = this.pts.slice(-6);
  }
  release(t, r, exp) { this._restart(t); if (exp) this._target(0, t, r); else this._ramp(0, t + r); }
}

// Noise buffers, one per colour. Pink: Paul Kellet's filter; brown: integrated white noise.
const noiseBufs = {};
export function noiseBuffer(ctx, color = 'white') {
  const key = color + ':' + ctx.sampleRate;
  if (noiseBufs[key]) return noiseBufs[key];
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0, peak = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    } else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last; }
    else d[i] = w;
    peak = Math.max(peak, Math.abs(d[i]));
  }
  if (color !== 'white') for (let i = 0; i < d.length; i++) d[i] *= 0.9 / peak; // same peak level as white
  return (noiseBufs[key] = buf);
}
