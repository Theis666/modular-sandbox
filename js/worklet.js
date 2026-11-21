// AudioWorklet processors (ROADMAP M3, ADR 0010). Plain JS, loaded with audioWorklet.addModule.
// Signal convention as in modules.js: pitch in octaves (0 = C3), audio about -1..+1.
const C3 = 130.8128;

// PolyBLEP: rounds off the jump of a saw or pulse wave inside one sample, which removes most aliasing.
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

class VCO extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'oct', defaultValue: 0, automationRate: 'k-rate' },     // Octave + Fine + Ratio, in octaves
      { name: 'pw', defaultValue: 0.5, minValue: 0.02, maxValue: 0.98 }, // pulse width (square wave)
      { name: 'lin', defaultValue: 0, automationRate: 'k-rate' },     // linear FM amount
      { name: 'drift', defaultValue: 0, automationRate: 'k-rate' },   // analog drift, in cents
      { name: 'wave', defaultValue: 2, automationRate: 'k-rate' }     // 0 sine, 1 triangle, 2 saw, 3 square
    ];
  }
  constructor() {
    super();
    this.ph = 0; this.sub = 1; this.lastSync = 0; // phase 0 like the built-in oscillator, so old patches sound the same
    this.dr = 0; this.drTarget = 0; this.drCount = 0; this.tri = 0;
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0], sub = outputs[1] && outputs[1][0];
    if (!out) return true;
    const pIn = inputs[0][0], fmIn = inputs[1][0], linIn = inputs[2][0], pwIn = inputs[3][0], syncIn = inputs[4][0];
    const oct = params.oct[0], lin = params.lin[0], wave = Math.round(params.wave[0]), drift = params.drift[0];
    const pwP = params.pw, sr = sampleRate;
    // drift: a slow random walk, new target about every half second
    if (drift > 0) {
      if (--this.drCount <= 0) { this.drTarget = (Math.random() * 2 - 1) * drift / 1200; this.drCount = Math.round(sr / 128 * 0.5); }
      this.dr += (this.drTarget - this.dr) * 0.01;
    } else this.dr = 0;
    // when pitch and FM do not move within this block (the usual case), compute the frequency once
    const N = out.length, still = (!pIn || pIn[0] === pIn[N - 1]) && (!fmIn || fmIn[0] === fmIn[N - 1]);
    const f0 = still ? C3 * Math.pow(2, oct + this.dr + (pIn ? pIn[0] : 0) + (fmIn ? fmIn[0] : 0)) : 0;
    for (let i = 0; i < N; i++) {
      let f = still ? f0 : C3 * Math.pow(2, oct + this.dr + (pIn ? pIn[i] : 0) + (fmIn ? fmIn[i] : 0));
      if (linIn) f *= 1 + lin * linIn[i];         // linear (through-zero) FM: the note stays in tune
      let dt = f / sr;
      if (syncIn) { const s = syncIn[i]; if (this.lastSync < 0 && s >= 0) this.ph = 0; this.lastSync = s; } // hard sync
      // each wave starts at 0 and rises, like the browser's built-in oscillator (sine series)
      const adt = Math.min(0.5, Math.abs(dt)), ph = (this.ph + (wave === 2 ? 0.5 : wave === 1 ? 0.25 : 0)) % 1;
      const pw = Math.min(0.98, Math.max(0.02, (pwP.length > 1 ? pwP[i] : pwP[0]) + (pwIn ? pwIn[i] * 0.45 : 0)));
      let v;
      if (wave === 0) v = Math.sin(2 * Math.PI * ph);
      else if (wave === 1) v = 1 - 4 * Math.abs(ph - 0.5);  // triangle: its overtones are weak, so it barely aliases
      else if (wave === 2) v = 2 * ph - 1 - blep(ph, adt);
      else v = (ph < pw ? 1 : -1) + blep(ph, adt) - blep((ph - pw + 1) % 1, adt);
      // saw and square at the level of the browser's built-in oscillator (it scales them by about 0.847)
      if (wave >= 2) v *= 0.847;
      out[i] = v;
      this.ph += dt;
      if (this.ph >= 1) { this.ph -= Math.floor(this.ph); this.sub = -this.sub; }
      else if (this.ph < 0) { this.ph += 1 + Math.floor(-this.ph); this.sub = -this.sub; }
      if (sub) sub[i] = this.sub;
    }
    return true;
  }
}
registerProcessor('mss-vco', VCO);

// Ladder filter (Moog style), after the well-known Stilson/Smith model (musicdsp.org "Moog VCF"):
// four one-pole stages with feedback from the last one and a soft clipper. Resonance near 1
// makes it whistle on its own (self-oscillation); bass drops as resonance rises, which `keep` makes up for.
class Ladder extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'cutoff', defaultValue: 1000, minValue: 20, maxValue: 20000 },
      { name: 'res', defaultValue: 0.2, minValue: 0, maxValue: 1 },
      { name: 'keep', defaultValue: 1, automationRate: 'k-rate' }
    ];
  }
  constructor() { super(); this.b = [0, 0, 0, 0, 0]; }
  process(inputs, outputs, params) {
    const out = outputs[0][0]; if (!out) return true;
    const x = inputs[0][0], cvIn = inputs[1][0]; // cvIn: cutoff offset in cents (from the CV inputs)
    const b = this.b, sr = sampleRate, cutP = params.cutoff, resP = params.res, keep = params.keep[0];
    const N = out.length, still = (!cvIn || cvIn[0] === cvIn[N - 1]) && cutP.length === 1 && resP.length === 1;
    let p = 0, fk = 0, q = 0;
    const coef = i => {
      const fc = (cutP.length > 1 ? cutP[i] : cutP[0]) * Math.pow(2, (cvIn ? cvIn[i] : 0) / 1200);
      const f = Math.min(0.99, Math.max(0.0005, 2 * fc / sr)), res = resP.length > 1 ? resP[i] : resP[0];
      const q0 = 1 - f; p = f + 0.8 * f * q0; fk = p + p - 1;
      q = res * (1 + 0.5 * q0 * (1 - q0 + 5.6 * q0 * q0));
    };
    if (still) coef(0);
    for (let i = 0; i < N; i++) {
      if (!still) coef(i);
      const inp = Math.tanh((x ? x[i] : 0)) - q * b[4];
      let t1 = b[1]; b[1] = (inp + b[0]) * p - b[1] * fk;
      let t2 = b[2]; b[2] = (b[1] + t1) * p - b[2] * fk;
      t1 = b[3]; b[3] = (b[2] + t2) * p - b[3] * fk;
      b[4] = (b[3] + t1) * p - b[4] * fk;
      b[4] -= b[4] * b[4] * b[4] * 0.166667;
      b[0] = inp;
      out[i] = b[4] * (keep ? 1 + q * 0.5 : 1);
    }
    return true;
  }
}
registerProcessor('mss-ladder', Ladder);

// Trigger (M3-6): turns any signal into Gate events. The main thread receives the times by message.
class Trigger extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'thr', defaultValue: 0, automationRate: 'k-rate' }]; }
  constructor() { super(); this.on = false; }
  process(inputs, outputs, params) {
    const x = inputs[0][0]; if (!x) return true;
    const thr = params.thr[0], hys = 0.02;
    for (let i = 0; i < x.length; i++) {
      if (!this.on && x[i] > thr + hys) { this.on = true; this.port.postMessage([1, currentTime + i / sampleRate]); }
      else if (this.on && x[i] < thr - hys) { this.on = false; this.port.postMessage([0, currentTime + i / sampleRate]); }
    }
    return true;
  }
}
registerProcessor('mss-trigger', Trigger);

// Gate times arrive by message; this helper tells, per sample, whether an event is due.
class Events {
  constructor(port, onMsg) { this.q = []; port.onmessage = e => { this.q.push(e.data); this.q.sort((a, b) => a.t - b.t); onMsg && onMsg(e.data); }; }
  due(t) { return this.q.length && this.q[0].t <= t ? this.q.shift() : null; }
}

// M4-2 Sample & Hold: on every gate, takes the value at In (or a random value when nothing is patched) and holds it.
class SampleHold extends AudioWorkletProcessor {
  constructor() { super(); this.v = 0; this.ev = new Events(this.port); }
  process(inputs, outputs) {
    const out = outputs[0][0]; if (!out) return true;
    const x = inputs[0][0], t0 = currentTime;
    for (let i = 0; i < out.length; i++) {
      let e; while ((e = this.ev.due(t0 + i / sampleRate))) if (e.on) this.v = e.rand || !x ? Math.random() * 2 - 1 : x[i];
      out[i] = this.v;
    }
    return true;
  }
}
registerProcessor('mss-sh', SampleHold);

// M4-3 Slew: the output follows the input, but can only rise or fall so fast (glide for any signal)
class Slew extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'rise', defaultValue: 0.1, automationRate: 'k-rate' }, { name: 'fall', defaultValue: 0.1, automationRate: 'k-rate' }]; }
  constructor() { super(); this.y = 0; }
  process(inputs, outputs, params) {
    const out = outputs[0][0]; if (!out) return true;
    const x = inputs[0][0], up = 1 / Math.max(1, params.rise[0] * sampleRate), dn = 1 / Math.max(1, params.fall[0] * sampleRate);
    for (let i = 0; i < out.length; i++) {
      const target = x ? x[i] : 0, d = target - this.y;
      this.y += d > 0 ? Math.min(d, up * 2) : Math.max(d, -dn * 2); // full range (-1..1) in the set time
      out[i] = this.y;
    }
    return true;
  }
}
registerProcessor('mss-slew', Slew);

// M4-8 DX: six sine operators as three modulator → carrier pairs (DX7 algorithm 5), with phase modulation
// like the real DX7. Pair 1 makes the tine, pair 2 the body, pair 3 (detuned) the width.
class FM6 extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = name => ({ name, automationRate: 'k-rate', defaultValue: 0 });
    return ['r1', 'r2', 'r3', 'l1', 'l2', 'l3', 'dec', 'adec', 'rel', 'det'].map(k);
  }
  constructor() {
    super();
    this.mp = [0, 0, 0]; this.cp = [0, 0, 0];
    this.amp = 0; this.menv = [0, 0, 0]; this.gate = false; this.vel = 0.8;
    this.ev = new Events(this.port);
  }
  process(inputs, outputs, P) {
    const out = outputs[0][0]; if (!out) return true;
    const pIn = inputs[0][0], vIn = inputs[1][0], sr = sampleRate, t0 = currentTime, TAU = 2 * Math.PI;
    const r = [P.r1[0], P.r2[0], P.r3[0]], l = [P.l1[0], P.l2[0], P.l3[0]];
    const det = Math.pow(2, P.det[0] / 1200);
    const kAmp = Math.exp(-1 / (Math.max(0.01, P.adec[0]) * sr / 4)), kRel = Math.exp(-1 / (Math.max(0.01, P.rel[0]) * sr / 4));
    const mdec = [0.25, 1, 0.6].map(f => Math.exp(-1 / (Math.max(0.01, P.dec[0] * f) * sr / 4)));
    for (let i = 0; i < out.length; i++) {
      let e; while ((e = this.ev.due(t0 + i / sr))) {
        this.gate = !!e.on;
        if (e.on) { this.vel = vIn ? Math.max(0.1, vIn[i]) : 0.8; this.att = true; this.menv = [1, 1, 1]; }
      }
      const f = 130.8128 * Math.pow(2, pIn ? pIn[i] : 0) / sr;
      let sum = 0;
      for (let j = 0; j < 3; j++) {
        this.mp[j] += f * r[j]; this.cp[j] += f * (j === 2 ? det : 1);
        if (this.mp[j] > 1) this.mp[j] -= Math.floor(this.mp[j]);
        if (this.cp[j] > 1) this.cp[j] -= Math.floor(this.cp[j]);
        const mod = Math.sin(TAU * this.mp[j]) * l[j] * 6 * this.menv[j] * (0.4 + 0.6 * this.vel);
        sum += Math.sin(TAU * this.cp[j] + mod);
        this.menv[j] *= mdec[j];
      }
      // 2 ms attack (no click), then the decay while held, or the release after the key
      if (this.att) { this.amp += (1 - this.amp) * (1 - Math.exp(-1 / (0.002 * sr))); if (this.amp > 0.995) this.att = false; }
      else this.amp *= this.gate ? kAmp : kRel;
      out[i] = sum / 3 * this.amp * (0.5 + 0.5 * this.vel);
    }
    return true;
  }
}
registerProcessor('mss-fm6', FM6);
