// Module definitions: panel layout, info texts, and audio construction.
// Signal convention: audio swings about -1..+1. Pitch: 0 = C3, 1 unit = 1 octave.
import { GateOut, Envelope, noiseBuffer, engine } from './engine.js';

const C3 = 130.8128;
const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];
const WAVE_LABELS = ['Sine', 'Triangle', 'Saw', 'Square']; // shown as drawings (icons: true)
const LFO_WAVES = [...WAVES, 'random', 'sh'];
const LFO_WAVE_LABELS = [...WAVE_LABELS, 'Smooth random', 'Sample & hold'];

const disconnectAll = (...nodes) => nodes.forEach(n => { try { n.disconnect(); } catch (e) {} });

export const MODULES = {
  keyboard: {
    name: 'Keyboard', hp: 6, accent: '#f2c14e', display: 'voices',
    info: {
      title: 'Keyboard',
      text: 'The keys at the bottom of the screen belong to this module. It does not make any sound itself. When you press a key it sends two signals out of its jacks: a Pitch (which note) and a Gate (is a key held down right now?). Other modules decide what to do with them.',
      tryThis: 'Patch Pitch into a VCO\'s Pitch input and Gate into an ADSR\'s Gate input. Now the keys control both the note and the envelope.'
    },
    controls: [
      { id: 'glide', label: 'Glide', min: 0, max: 1, def: 0, curve: 'exp', unit: 's',
        info: 'How long the pitch takes to slide from one note to the next. At zero, notes jump instantly. Turn it up and play two keys one after another to hear the slide (also called portamento).' },
      { id: 'voices', label: 'Voices', min: 1, max: 8, def: 1, step: 1, unit: 'n',
        info: 'How many notes can sound at once. At 1 the synth plays one note at a time (monophonic). Above 1 every module behind the Keyboard (VCOs, filters, envelopes, VCAs, mixers) is copied once per voice inside the app, so each held key gets its own copy of the patch (polyphonic). Effects and the Output stay single: all voices meet there. Poly cables are drawn thicker, and copied modules show a small ×-badge.' },
      { id: 'unison', label: 'Unison', expert: true, min: 1, max: 4, def: 1, step: 1, unit: 'n', info: 'How many voices one key plays at once, slightly out of tune with each other (Spread): a fat, wide sound for leads and basses. Needs Voices set at least as high: with 4 Voices and Unison 2 you can play 2 notes at once.' },
      { id: 'steal', label: 'Steal', full: 'Voice stealing', expert: true, type: 'select', options: ['oldest', 'lowest', 'highest', 'none'], labels: ['Oldest', 'Lowest', 'Highest', 'None'], def: 'oldest', info: 'What happens when all Voices are busy and you press another key. Oldest: the note held longest stops. Lowest / Highest: the lowest or highest note stops, so a bass note or melody on top is kept. None: the new key is ignored until a voice is free.' },
      { id: 'spread', label: 'Spread', expert: true, min: 0, max: 50, def: 10, unit: 'ct', info: 'How far the Unison voices are detuned against each other, in cents (100 cents = one semitone). A few cents sound wide and lively, many cents sound sour.' }
    ],
    inputs: [],
    outputs: [
      { id: 'pitch', label: 'Pitch', kind: 'signal', sig: 'pitch', info: 'Sends the note of the last key you pressed. Higher keys send a higher value: exactly one unit more for every octave. Patch it into a VCO\'s Pitch input.' },
      { id: 'gate', label: 'Gate', kind: 'gate', info: 'Is ON while a key is held down and OFF when you let go. Patch it into an ADSR to shape the loudness or brightness of every note.' },
      { id: 'vel', label: 'Vel', kind: 'signal', sig: 'cv', info: 'Velocity: how hard you play. On the screen keys, touching a key near its front edge plays loud (up to 1), near the back soft (down to 0.3). Patch it into a VCA or VCF CV input, so loud notes are louder or brighter, like on a piano.' },
      { id: 'mod', label: 'Mod', kind: 'signal', sig: 'cv', info: 'The mod strip left of the keys: slide up and down to send a value from 0 to 1, which stays where you leave it (like a mod wheel). Patch it into a VCF Cutoff to open the filter by hand while you play, or into an LFO-controlled VCA CV for expressive vibrato.' }
    ],
    create(ctx, p) {
      // up to 8 voices, each with its own Pitch, Gate and Velocity; voice 0 is what the jacks show (ADR 0008)
      const MAXV = 8;
      const src = v => { const c = ctx.createConstantSource(); c.offset.value = v; c.start(); return c; };
      const pitches = [], gates = [], vels = [];
      for (let k = 0; k < MAXV; k++) { pitches.push(src(0)); gates.push(new GateOut()); vels.push(src(0.8)); }
      const mod = src(0); // the mod strip beside the keys: one value for all voices
      const stack = [];                       // mono: held notes, last one wins
      const held = new Array(MAXV).fill(null); // poly: the note each voice plays
      const started = new Array(MAXV).fill(0), released = new Array(MAXV).fill(0);
      let clock = 0;
      const nVoices = () => Math.max(1, Math.min(MAXV, Math.round(p.voices || 1)));
      const setPitch = (k, note, t, cents = 0) => {
        const v = (note - 48) / 12 + cents / 1200, o = pitches[k].offset, g = p.glide;
        o.cancelScheduledValues(t);
        if (g > 0.001) o.setTargetAtTime(v, t, g / 3); else o.setValueAtTime(v, t);
      };
      const setVel = (k, vel, t) => vels[k].offset.setValueAtTime(vel ?? 0.8, t);
      const allOff = () => {
        const t = ctx.currentTime; stack.length = 0;
        for (let k = 0; k < MAXV; k++) { held[k] = null; gates[k].emit(false, t); }
      };
      // a free voice (released longest ago, so release tails ring out), else the oldest note is taken over
      const grab = (n, avoid) => {
        let v = -1;
        for (let k = 0; k < n; k++) if (held[k] == null && !avoid.includes(k) && (v < 0 || released[k] < released[v])) v = k;
        if (v >= 0) return v;
        // all busy: voice stealing
        const mode = p.steal || 'oldest';
        if (mode === 'none') return -1;
        for (let k = 0; k < n; k++) {
          if (avoid.includes(k)) continue;
          if (v < 0) { v = k; continue; }
          if (mode === 'oldest' ? started[k] < started[v] : mode === 'lowest' ? held[k] < held[v] : held[k] > held[v]) v = k;
        }
        return v;
      };
      return {
        outputs: { pitch: pitches[0], gate: gates[0], vel: vels[0], mod }, inputs: {},
        voice: k => ({ pitch: pitches[k], gate: gates[k], vel: vels[k], mod }),
        set(id) { if (id === 'voices' || id === 'unison') allOff(); },
        setMod(v) { mod.offset.setTargetAtTime(v, ctx.currentTime, 0.01); },
        noteOn(note, vel) {
          const t = ctx.currentTime, n = nVoices();
          if (n === 1) {
            const i = stack.indexOf(note); if (i >= 0) stack.splice(i, 1);
            stack.push(note); setPitch(0, note, t); setVel(0, vel, t); gates[0].emit(true, t); return;
          }
          // Unison: one key plays several voices, spread in pitch around the note (M2-3)
          const u = Math.max(1, Math.min(n, Math.round(p.unison || 1))), used = [];
          for (let j = 0; j < u; j++) {
            const v = grab(n, used); if (v < 0) break; used.push(v);
            if (held[v] != null) gates[v].emit(false, t);
            held[v] = note; started[v] = ++clock;
            const cents = u > 1 ? (p.spread || 0) * (j / (u - 1) * 2 - 1) : 0;
            setPitch(v, note, t, cents); setVel(v, vel, t); gates[v].emit(true, t);
          }
        },
        noteOff(note) {
          const t = ctx.currentTime;
          if (nVoices() === 1) {
            const i = stack.indexOf(note); if (i >= 0) stack.splice(i, 1);
            if (stack.length) setPitch(0, stack[stack.length - 1], t); else gates[0].emit(false, t);
            return;
          }
          for (let v = 0; v < MAXV; v++) if (held[v] === note) { held[v] = null; released[v] = ++clock; gates[v].emit(false, t); }
        },
        allOff,
        active: () => held.slice(0, nVoices()).map((h, k) => (nVoices() === 1 ? gates[0].isOn(ctx.currentTime) : h != null)),
        destroy() { [...pitches, ...vels, mod].forEach(c => { c.stop(); disconnectAll(c); }); }
      };
    }
  },

  sequencer: {
    name: 'Sequencer', hp: 14, accent: '#f2c14e',
    info: {
      title: 'Sequencer',
      text: 'A sequencer is a robot that plays a keyboard for you. It walks through its steps in a loop: 8 at first, up to 16 (Steps, on the More page). Each step has its own note, set with a small knob, and a light button above it that switches the step on or off (an off step is a rest). The buttons 1–8 and 9–16 show the first or the second eight steps. For every step that is on it sends a Pitch and a short Gate, exactly like the Keyboard does.',
      tryThis: 'Press Run, then turn the step knobs while it plays. Turn Length down for short, plucky notes and up for long ones.'
    },
    controls: [
      // 16 steps, shown eight at a time (bank 0: steps 1–8, bank 1: steps 9–16)
      ...Array.from({ length: 16 }, (_, i) => ({
        id: 's' + (i + 1), label: String(i + 1), min: 0, max: 24, def: [0, 12, 7, 0, 3, 12, 10, 7][i % 8], step: 1, unit: 'st', small: true, bank: i >> 3,
        info: 'The note of step ' + (i + 1) + ', in semitones above the lowest note. 12 semitones is one octave up.'
      })),
      ...Array.from({ length: 16 }, (_, i) => ({
        id: 'g' + (i + 1), label: 'Step ' + (i + 1), type: 'toggle', def: 1, small: true, stepGate: i + 1, bank: i >> 3,
        info: 'Switches step ' + (i + 1) + ' on or off. An off step is a rest: no Gate, so no note, but the sequencer still counts it.'
      })),
      { id: 'tempo', label: 'Tempo', min: 40, max: 240, def: 110, step: 1, unit: 'bpm', info: 'Speed in BPM (beats per minute). The sequencer plays two steps per beat.' },
      { id: 'len', label: 'Length', min: 0.05, max: 0.95, def: 0.5, info: 'How long each Gate stays ON, as a part of one step. Short = staccato, long = legato.' },
      { id: 'run', label: 'Run', type: 'toggle', def: 0, info: 'Starts and stops the sequencer.' },
      { id: 'last', label: 'Steps', expert: true, min: 1, max: 16, def: 8, step: 1, unit: 'n', info: 'How many steps the loop has: at 5 it plays steps 1 to 5 and starts again; at 16 it plays all sixteen (set steps 9–16 with the 9–16 button). Odd lengths against an even beat make lines that shift and surprise.' },
      { id: 'dir', label: 'Direction', expert: true, type: 'select', options: ['fwd', 'back', 'pingpong', 'random'], labels: ['→', '←', '↔', '?'], def: 'fwd', info: 'The order of the steps: → forward, ← backward, ↔ forward and back, ? a random step each time.' },
      ...Array.from({ length: 16 }, (_, i) => ({
        id: 'sl' + (i + 1), label: (i + 1) + '~', full: 'Slide ' + (i + 1), type: 'toggle', def: 0, expert: true, mini: true, bank: i >> 3,
        info: 'Slide on step ' + (i + 1) + ': the pitch glides into this step from the one before, and the note is tied (no new attack). This is the rubbery sound of acid basslines.'
      })),
      ...Array.from({ length: 16 }, (_, i) => ({
        id: 'ac' + (i + 1), label: (i + 1) + '!', full: 'Accent ' + (i + 1), type: 'toggle', def: 0, expert: true, mini: true, bank: i >> 3,
        info: 'Accent on step ' + (i + 1) + ': the Acc output is 1 during this step and 0 otherwise. Patch Acc into a VCA or VCF CV to make accented steps louder or brighter.'
      }))
    ],
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate', info: 'Patch a Clock module here and every pulse moves one step forward; the Tempo knob is then ignored. Several sequencers and arps on one Clock stay exactly in time.' },
      { id: 'transp', label: 'Transp', full: 'Transpose', kind: 'signal', info: 'Transpose: a Pitch here is added to every step. Patch the Keyboard\'s Pitch in and the whole line moves to the key you press, the way Moroder played sequences live.' }
    ],
    outputs: [
      { id: 'pitch', label: 'Pitch', kind: 'signal', sig: 'pitch', info: 'The note of the current step. Patch it into a VCO\'s Pitch input.' },
      { id: 'gate', label: 'Gate', kind: 'gate', info: 'Turns ON at the start of every step and OFF after the Length time. Patch it into an ADSR\'s Gate input.' },
      { id: 'acc', label: 'Acc', full: 'Accent', kind: 'signal', sig: 'cv', info: 'Accent: 1 during steps whose accent (More page) is on, else 0. Patch it into a VCA or VCF CV.' }
    ],
    create(ctx, p, hooks) {
      const src = ctx.createConstantSource(); src.offset.value = 0; src.start();
      const transIn = ctx.createGain(), pitch = ctx.createGain(); src.connect(pitch); transIn.connect(pitch);
      const acc = ctx.createConstantSource(); acc.offset.value = 0; acc.start();
      const gate = new GateOut();
      let pos = -1, dirSign = 1, next = 0, timer = null, lastClock = -10, tied = false;
      const last = () => Math.max(1, Math.min(16, Math.round(p.last || 8)));
      const advance = () => {
        const n = last();
        if (p.dir === 'random') return (pos = Math.floor(Math.random() * n));
        if (p.dir === 'back') return (pos = pos <= 0 || pos >= n ? n - 1 : pos - 1);
        if (p.dir === 'pingpong') {
          if (n === 1) return (pos = 0);
          let q = pos + dirSign; if (q >= n || q < 0) { dirSign = -dirSign; q = pos + dirSign; }
          return (pos = Math.max(0, Math.min(n - 1, q)));
        }
        return (pos = (pos + 1) % n);
      };
      // one step at time t that lasts dur seconds
      const play = (t, dur) => {
        const s = advance(), on = p['g' + (s + 1)] !== 0, slide = !!p['sl' + (s + 1)];
        const v = p['s' + (s + 1)] / 12;
        src.offset.cancelScheduledValues(t);
        if (slide && tied) src.offset.setTargetAtTime(v, t, dur * 0.15); else src.offset.setValueAtTime(v, t);
        acc.offset.setValueAtTime(p['ac' + (s + 1)] ? 1 : 0, t);
        // tie into the next step if it slides: no gate off now, no new attack then
        const n = last(), peek = p.dir === 'fwd' || !p.dir ? (s + 1) % n : -1;
        const nextSlides = peek >= 0 && !!p['sl' + (peek + 1)] && p['g' + (peek + 1)] !== 0;
        if (on) {
          if (!(slide && tied)) gate.emit(true, t);
          if (!nextSlides) gate.emit(false, t + dur * p.len);
          tied = nextSlides;
        } else { if (tied) gate.emit(false, t); tied = false; }
        setTimeout(() => hooks && hooks.step && hooks.step(s), Math.max(0, (t - ctx.currentTime) * 1000));
      };
      const tick = () => {
        // a Clock pulse in the last second means an external clock drives the steps
        if (ctx.currentTime - lastClock < 1) { next = ctx.currentTime + 0.05; return; }
        while (next < ctx.currentTime + 0.12) { const d = 30 / p.tempo; play(next, d); next += d; }
      };
      const onClock = (on, t) => {
        if (!on || !p.run) return;
        const d = lastClock > 0 && t - lastClock < 2 ? t - lastClock : 30 / p.tempo;
        lastClock = t; play(t, d);
      };
      const run = on => {
        // the first tick waits for the interval: cables are connected after the module is created, and a
        // Clock patched to the Clock input sends its first pulse in the meantime (so step 1 plays on it)
        if (on && !timer) { pos = -1; dirSign = 1; tied = false; next = ctx.currentTime + 0.05; timer = setInterval(tick, 25); }
        if (!on && timer) { clearInterval(timer); timer = null; gate.emit(false, ctx.currentTime); tied = false; hooks && hooks.step && hooks.step(-1); }
      };
      run(!!p.run);
      return {
        outputs: { pitch, gate, acc }, inputs: { clock: onClock, transp: transIn },
        set(id, v) { if (id === 'run') run(!!v); },
        destroy() { run(false); src.stop(); acc.stop(); disconnectAll(src, transIn, pitch, acc); }
      };
    }
  },

  // M2-4: one tempo for everything that plays in time
  clock: {
    name: 'Clock', hp: 6, accent: '#f2c14e',
    info: {
      title: 'Clock',
      text: 'A clock sends a steady stream of short Gate pulses: the heartbeat of a patch. Patch it into the Clock input of Sequencers and Arps and they all play exactly in time with each other, at the clock\'s Tempo. Swing delays every second pulse a little, which makes a stiff rhythm groove.',
      tryThis: 'Patch Clock into a Sequencer\'s Clock input, press Run on both, then turn Swing up slowly.'
    },
    controls: [
      { id: 'tempo', label: 'Tempo', min: 40, max: 240, def: 120, step: 1, unit: 'bpm', info: 'Speed in BPM (beats per minute).' },
      { id: 'div', label: 'Pulses', type: 'select', options: ['1/8', '1/16'], labels: ['1/8', '1/16'], def: '1/8', info: 'How many pulses per beat at the Clock output: 1/8 sends two (one step of the Sequencer per eighth note, as without a clock), 1/16 sends four.' },
      { id: 'swing', label: 'Swing', min: 0, max: 0.5, def: 0, info: 'Delays every second pulse. 0 is straight; around 0.15 to 0.25 swings like a drummer; more limps.' },
      { id: 'run', label: 'Run', type: 'toggle', def: 1, info: 'Starts and stops the pulses.' }
    ],
    inputs: [],
    outputs: [
      { id: 'clock', label: 'Clock', kind: 'gate', info: 'The pulses, at the speed set by Tempo and Pulses. Patch into a Sequencer\'s or Arp\'s Clock input.' },
      { id: 'beat', label: 'Beat', kind: 'gate', info: 'One pulse per beat (quarter note), for example to retrigger an envelope or reset an LFO in time.' }
    ],
    create(ctx, p) {
      const clock = new GateOut(), beat = new GateOut();
      let n = 0, next = 0, timer = null;
      const tick = () => {
        const per = 60 / p.tempo / (p.div === '1/16' ? 4 : 2), perBeat = p.div === '1/16' ? 4 : 2;
        while (next < ctx.currentTime + 0.12) {
          const t = next + (n % 2 ? p.swing * per : 0);
          clock.emit(true, t); clock.emit(false, t + per * 0.5);
          if (n % perBeat === 0) { beat.emit(true, t); beat.emit(false, t + per * 0.5); }
          n++; next += per;
        }
      };
      const run = on => {
        // first pulses right after this call, once the cables of a loaded patch are connected
        if (on && !timer) { n = 0; next = ctx.currentTime + 0.05; setTimeout(tick, 0); timer = setInterval(tick, 25); }
        if (!on && timer) { clearInterval(timer); timer = null; }
      };
      run(!!p.run);
      return {
        outputs: { clock, beat }, inputs: {},
        set(id, v) { if (id === 'run') run(!!v); },
        destroy() { run(false); }
      };
    }
  },

  vco: {
    name: 'VCO', hp: 8, accent: '#e2574c', display: 'wave',
    info: {
      title: 'VCO · Voltage-Controlled Oscillator',
      text: 'The VCO is where sound begins. It vibrates back and forth hundreds of times per second, and you hear that vibration as a tone. How fast it vibrates is the pitch. "Voltage-controlled" means a cable can set the pitch, not only your hand on the knob. The shape of the vibration (the waveform, drawn on the Wave button) is the colour of the sound: Sine is pure and soft, Triangle is a little brighter, Saw is bright and buzzy, Square is hollow.',
      tryThis: 'Tap a cable coming out of the VCO to see its waveform in the Scope, then switch the Wave and watch the shape change.'
    },
    controls: [
      { id: 'wave', label: 'Wave', type: 'select', options: WAVES, labels: WAVE_LABELS, icons: true, def: 'sawtooth', info: 'The shape of the vibration, drawn on the button. Tap to switch. Sine (smooth round curve): pure. Triangle (straight zigzag): soft. Saw (slow rise, sudden drop): bright and buzzy, full of overtones, great for filtering. Square (jumps between high and low): hollow, like a clarinet.' },
      { id: 'tune', label: 'Octave', min: -3, max: 3, def: 0, step: 1, unit: 'oct', info: 'Shifts the pitch in whole octaves. One octave up doubles the speed of the vibration.' },
      { id: 'fine', label: 'Fine', min: -100, max: 100, def: 0, unit: 'ct', info: 'Fine tuning in cents (100 cents = one semitone). Two VCOs slightly detuned against each other sound wide and "chorusy".' },
      { id: 'ratio', label: 'Ratio', expert: true, min: 0.5, max: 16, def: 1, step: 0.5, unit: '×', info: 'Multiplies the frequency: at 2 the VCO plays twice as fast (one octave up), at 14 fourteen times as fast. For normal playing leave it at 1. In FM (Frequency Modulation) the ratio between a modulator and its carrier decides which overtones appear: whole numbers sound harmonic, a high ratio like 14 gives a metallic, bell-like attack. This is how the Yamaha DX7 sets its operators.' },
      { id: 'fm', label: 'FM Amt', full: 'FM Amount', min: 0, max: 1, def: 0.5, info: 'How strongly the signal at the FM (Frequency Modulation) input bends the pitch. With a slow LFO this gives vibrato; with another VCO it gives glassy, bell-like tones.' },
      { id: 'pw', label: 'Width', full: 'Pulse Width', expert: true, min: 0.05, max: 0.95, def: 0.5, info: 'Only for the square wave: how long it stays high in each cycle. At 0.5 it is a true square (hollow, clarinet-like); towards the ends it gets thin and nasal. Moving it with an LFO at the PWM input (Pulse Width Modulation) gives the lush, chorused sound of classic string machines.' },
      { id: 'lin', label: 'Lin FM', full: 'Linear FM Amount', expert: true, min: 0, max: 8, def: 0, curve: 'exp', info: 'How strongly the signal at the Lin input changes the frequency, in a straight line (linear FM). Unlike the FM input it keeps the note in tune even with a lot of modulation, which is how the Yamaha DX7 works: another VCO at Lin gives bright, bell-like FM tones that stay on pitch.' },
      { id: 'drift', label: 'Drift', expert: true, min: 0, max: 20, def: 0, unit: 'ct', info: 'A tiny, slow, random change of pitch, in cents (100 cents = one semitone), like an analog oscillator that is never perfectly stable. A few cents make two VCOs beat against each other in a lively way.' }
    ],
    inputs: [
      { id: 'pitch', label: 'Pitch', kind: 'signal', info: 'Sets the note. Every unit of signal raises the pitch by exactly one octave. Usually comes from a Keyboard or Sequencer.' },
      { id: 'fm', label: 'FM', kind: 'signal', info: 'Frequency Modulation: a second pitch input, scaled by the FM Amt knob. Patch an LFO here for vibrato.' },
      { id: 'lfm', label: 'Lin', full: 'Linear FM', kind: 'signal', info: 'Linear FM input, scaled by Lin FM (on the More page). Patch another VCO here for DX7-style tones that stay in tune.' },
      { id: 'pwm', label: 'PWM', kind: 'signal', info: 'Pulse Width Modulation: moves the width of the square wave. A slow LFO here makes the square shimmer like a string ensemble.' },
      { id: 'sync', label: 'Sync', kind: 'signal', info: 'Hard sync: every time the signal here starts a new cycle, this VCO restarts its own cycle too. Patch another VCO here and turn this one\'s Octave or Fine: you get a hard, tearing lead sound.' }
    ],
    outputs: [
      { id: 'out', label: 'Out', kind: 'signal', sig: 'audio', info: 'The sound of the oscillator. Send it to a VCF to shape it, or straight to a VCA or Mixer.' },
      { id: 'sub', label: 'Sub', kind: 'signal', sig: 'audio', info: 'A square wave one octave below the oscillator: adds weight under basses and leads. Mix it in with a Mixer.' }
    ],
    create(ctx, p) {
      const WAVE_NO = { sine: 0, triangle: 1, sawtooth: 2, square: 3 };
      const octOf = () => p.tune + p.fine / 1200 + Math.log2(p.ratio || 1);
      const pitchIn = ctx.createGain(), fmIn = ctx.createGain(), linIn = ctx.createGain(), pwIn = ctx.createGain(), syncIn = ctx.createGain();
      const out = ctx.createGain(), sub = ctx.createGain();
      if (ctx.__mssWorklet) {
        // M3-1/M3-2: band-limited oscillator with pulse width, sync, linear FM, sub and drift (js/worklet.js)
        const node = new AudioWorkletNode(ctx, 'mss-vco', { numberOfInputs: 5, numberOfOutputs: 2, outputChannelCount: [1, 1] });
        fmIn.gain.value = p.fm;
        [pitchIn, fmIn, linIn, pwIn, syncIn].forEach((g, k) => g.connect(node, 0, k));
        node.connect(out, 0); node.connect(sub, 1);
        const P = name => node.parameters.get(name);
        const apply = () => {
          const t = ctx.currentTime;
          P('oct').setValueAtTime(octOf(), t); P('wave').setValueAtTime(WAVE_NO[p.wave] ?? 2, t);
          P('pw').setTargetAtTime(p.pw ?? 0.5, t, 0.01); P('lin').setValueAtTime(p.lin || 0, t); P('drift').setValueAtTime(p.drift || 0, t);
          fmIn.gain.setTargetAtTime(p.fm, t, 0.01);
        };
        apply();
        return { inputs: { pitch: pitchIn, fm: fmIn, lfm: linIn, pwm: pwIn, sync: syncIn }, outputs: { out, sub }, set: apply,
          destroy() { node.port.close && node.port.close(); disconnectAll(node, pitchIn, fmIn, linIn, pwIn, syncIn, out, sub); } };
      }
      // fallback without AudioWorklet: built-in oscillator (no pulse width, sync, linear FM, sub or drift)
      const osc = ctx.createOscillator(); osc.type = p.wave; osc.frequency.value = C3;
      pitchIn.gain.value = 1200; pitchIn.connect(osc.detune);
      fmIn.gain.value = p.fm * 1200; fmIn.connect(osc.detune);
      out.gain.value = 1; osc.connect(out); osc.start();
      const detune = () => { osc.detune.value = octOf() * 1200; };
      detune();
      return {
        inputs: { pitch: pitchIn, fm: fmIn, lfm: linIn, pwm: pwIn, sync: syncIn }, outputs: { out, sub },
        set(id, v) {
          if (id === 'wave') osc.type = v;
          else if (id === 'fm') fmIn.gain.setTargetAtTime(v * 1200, ctx.currentTime, 0.01);
          else detune();
        },
        destroy() { osc.stop(); disconnectAll(osc, pitchIn, fmIn, out); }
      };
    }
  },

  noise: {
    name: 'Noise', hp: 4, accent: '#9aa0a6',
    info: {
      title: 'Noise',
      text: 'Noise is random sound with no pitch at all: a hiss, like wind, waves or a detuned radio. It contains every frequency at once, which makes it perfect raw material for a filter.',
      tryThis: 'Send Noise through a VCF set to BP (band-pass) with high Resonance and slowly turn Cutoff: it sounds like wind.'
    },
    controls: [
      { id: 'level', label: 'Level', min: 0, max: 1, def: 0.6, info: 'How loud the noise is.' },
      { id: 'color', label: 'Colour', type: 'select', options: ['white', 'pink', 'brown'], labels: ['White', 'Pink', 'Brown'], def: 'white', info: 'White noise has equal energy at every frequency: a bright hiss. Pink noise has less treble: softer, like rain or the sea. Brown noise has even less: a deep rumble, like wind or a waterfall.' }
    ],
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'audio', info: 'The noise signal.' }],
    create(ctx, p) {
      const out = ctx.createGain(); out.gain.value = p.level;
      let src = null;
      const play = () => {
        if (src) { src.stop(); src.disconnect(); }
        src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, p.color); src.loop = true; src.connect(out);
        // M0-1: start at a random point, so two Noise modules (or poly copies) never play the same noise in step
        src.start(0, Math.random() * src.buffer.duration);
      };
      play();
      return {
        inputs: {}, outputs: { out },
        set(id, v) { if (id === 'color') play(); else out.gain.setTargetAtTime(v, ctx.currentTime, 0.01); },
        destroy() { src.stop(); disconnectAll(src, out); }
      };
    }
  },

  vcf: {
    name: 'VCF', hp: 10, accent: '#4c8de2', display: 'filter',
    info: {
      title: 'VCF · Voltage-Controlled Filter',
      text: 'A filter removes part of a sound, the way a sculptor removes stone. "Voltage-controlled" means a cable (for example from an envelope or LFO) can move the cutoff while you play. A low-pass filter (LP) lets the low frequencies through and cuts the high ones, so turning Cutoff down makes the sound darker and more muffled. Starting with a bright sound and filtering it is called subtractive synthesis.',
      tryThis: 'Play a Saw wave and slowly turn Cutoff from right to left. Then turn up Resonance and do it again.'
    },
    controls: [
      { id: 'type', label: 'Type', type: 'select', options: ['lowpass', 'lowpass24', 'ladder', 'highpass', 'bandpass', 'notch'], labels: ['LP', 'LP24', 'Lad', 'HP', 'BP', 'N'], def: 'lowpass', info: 'LP (low-pass) keeps the lows and cuts the highs: darker. LP24 is a steeper low-pass (24 dB per octave instead of 12). Lad (ladder) is a model of the classic Moog ladder filter: a steep low-pass that gets thick and squelchy with Resonance, loses bass as Resonance rises (Keep Lvl makes up for it) and whistles on its own when Resonance is fully up. HP (high-pass) keeps the highs and cuts the lows: thinner. BP (band-pass) keeps only a band around the cutoff: nasal, like a telephone. N (notch) is the opposite of band-pass: it cuts out a narrow band around the cutoff and keeps the rest, a hollow, phaser-like sound.' },
      { id: 'cutoff', label: 'Cutoff', min: 30, max: 16000, def: 1200, curve: 'exp', unit: 'Hz', info: 'The frequency where the filter starts cutting. This is the most important knob on a synth: it controls how bright the sound is.' },
      { id: 'res', label: 'Reso', full: 'Resonance', min: 0, max: 1, def: 0.2, info: 'Resonance boosts the frequencies right at the cutoff point. A little gives a sharper, "squelchy" character; a lot makes the filter whistle on its own.' },
      { id: 'cv', label: 'CV Amt', full: 'CV Amount', min: -1.5, max: 1.5, def: 0.6, info: 'How much the signal at the Cutoff input (a CV, Control Voltage) moves the cutoff. Negative values move it the opposite way. At 1, one unit of CV moves the cutoff by four octaves; at 1.5 by six.' },
      { id: 'track', label: 'Key Trk', full: 'Key Tracking', expert: true, min: 0, max: 1, def: 0, info: 'How much the cutoff follows the note at the Key input. At 0 the filter stays put; at 1 it moves exactly with the pitch, so high notes stay as bright as low ones.' },
      { id: 'drive', label: 'Drive', expert: true, min: 0, max: 1, def: 0, info: 'Pushes the sound into soft distortion before the filter. A little adds warmth and growl, a lot makes it rough. At 0 the sound passes clean.' },
      { id: 'keep', label: 'Keep Lvl', full: 'Keep Level', expert: true, type: 'toggle', def: 1, info: 'Only for the Lad filter: turns the level up as Resonance rises, so the bass does not disappear. Off is how a real ladder filter behaves.' },
      { id: 'cv2', label: 'Amt 2', full: 'Cut 2 Amount', expert: true, min: -1.5, max: 1.5, def: 0.6, info: 'How much the signal at the second cutoff input (Cut 2) moves the cutoff, like CV Amt (CV Amount) for the first one. Two inputs let an envelope and an LFO move the filter at the same time without a Mixer.' }
    ],
    inputs: [
      { id: 'in', label: 'In', kind: 'signal', info: 'The sound to be filtered, for example from a VCO or Noise.' },
      { id: 'cutoff', label: 'Cutoff', kind: 'signal', info: 'Moves the cutoff with a control signal (CV). An ADSR here makes every note start bright and get darker; an LFO here gives a "wah-wah" sweep.' },
      { id: 'key', label: 'Key', kind: 'signal', info: 'Patch the same Pitch that plays the VCO here, and turn up Key Trk: the filter then follows the notes you play (key tracking).' },
      { id: 'cutoff2', label: 'Cut 2', kind: 'signal', info: 'A second Cutoff input with its own amount (Amt 2, on the More page). Use it when two signals should move the cutoff, for example an envelope and an LFO.' }
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'follow:in', info: 'The filtered sound.' }],
    create(ctx, p) {
      // two filters in a row: the second one is only used in LP24 mode
      const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
      const direct = ctx.createGain(), steep = ctx.createGain(), out = ctx.createGain();
      f1.connect(direct).connect(out); f1.connect(f2).connect(steep).connect(out);
      const cvIn = ctx.createGain(), keyIn = ctx.createGain(), cv2In = ctx.createGain();
      [cvIn, keyIn, cv2In].forEach(g => { g.connect(f1.detune); g.connect(f2.detune); });
      // Drive: a soft clipper in front of the filter; at 0 the sound goes around it untouched
      const inG = ctx.createGain(), clean = ctx.createGain(), pre = ctx.createGain(), sat = ctx.createWaveShaper(), post = ctx.createGain();
      const tanh = new Float32Array(1025); for (let i = 0; i < tanh.length; i++) tanh[i] = Math.tanh((i / 512 - 1) * 3);
      sat.curve = tanh; sat.oversample = '2x';
      const mid = ctx.createGain(); mid.connect(f1);
      inG.connect(clean).connect(mid); inG.connect(pre).connect(sat).connect(post).connect(mid);
      // M3-4: ladder filter in the worklet, used when Type is Lad (without the worklet Lad falls back to LP24)
      let lad = null; const ladG = ctx.createGain(); ladG.gain.value = 0; ladG.connect(out);
      if (ctx.__mssWorklet) {
        lad = new AudioWorkletNode(ctx, 'mss-ladder', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
        mid.connect(lad, 0, 0); [cvIn, keyIn, cv2In].forEach(g => g.connect(lad, 0, 1)); lad.connect(ladG);
      }
      const apply = () => {
        const t = ctx.currentTime, ladder = p.type === 'ladder' && !!lad, lp24 = p.type === 'lowpass24' || (p.type === 'ladder' && !lad);
        const drv = p.drive || 0;
        clean.gain.setTargetAtTime(drv > 0 ? 0 : 1, t, 0.01);
        pre.gain.setTargetAtTime((1 + drv * 8) / 3, t, 0.01);          // the curve's input ±1 stands for ±3
        post.gain.setTargetAtTime(drv > 0 ? 1 / Math.tanh(1 + drv * 2) : 0, t, 0.01);
        cv2In.gain.setTargetAtTime((p.cv2 ?? 0.6) * 4800, t, 0.01);
        f1.type = lp24 || ladder ? 'lowpass' : p.type; f2.type = 'lowpass';
        ladG.gain.setTargetAtTime(ladder ? 1 : 0, t, 0.005);
        if (lad) { lad.parameters.get('cutoff').setTargetAtTime(p.cutoff, t, 0.01); lad.parameters.get('res').setTargetAtTime(Math.min(1, p.res), t, 0.01); lad.parameters.get('keep').setValueAtTime(p.keep ? 1 : 0, t); }
        f1.frequency.setTargetAtTime(p.cutoff, t, 0.01); f2.frequency.setTargetAtTime(p.cutoff, t, 0.01);
        // LP/HP Q is in dB, BP Q is linear (Web Audio spec). In LP24 the resonance sits on the second stage.
        const q = p.type === 'bandpass' || p.type === 'notch' ? 0.7 + p.res * 30 : -3 + p.res * 27;
        f1.Q.setTargetAtTime(lp24 ? -3 : q, t, 0.01); f2.Q.setTargetAtTime(q, t, 0.01);
        direct.gain.setTargetAtTime(lp24 || ladder ? 0 : 1, t, 0.005); steep.gain.setTargetAtTime(lp24 && !ladder ? 1 : 0, t, 0.005);
        cvIn.gain.setTargetAtTime(p.cv * 4800, t, 0.01);
        keyIn.gain.setTargetAtTime(p.track * 1200, t, 0.01);
      };
      apply();
      // magnitude response (linear) at the given frequencies, for the panel display
      const response = freqs => {
        const n = freqs.length, m1 = new Float32Array(n), m2 = new Float32Array(n), ph = new Float32Array(n);
        f1.getFrequencyResponse(freqs, m1, ph);
        if (p.type === 'ladder' && lad) { // the ladder has no built-in response: show a 4-pole low-pass with its resonance
          // H = 1 / ((1 + jr)^4 + k), with the feedback k and level make-up the worklet uses at low cutoffs
          const k = 3.8 * p.res, comp = p.keep ? 1 + 1.9 * p.res : 1;
          for (let i = 0; i < n; i++) { const r = freqs[i] / p.cutoff; m1[i] = comp / Math.hypot(1 - 6 * r * r + r ** 4 + k, 4 * r - 4 * r ** 3); }
          return m1;
        }
        if (p.type !== 'lowpass24') return m1;
        f2.getFrequencyResponse(freqs, m2, ph);
        for (let i = 0; i < n; i++) m1[i] *= m2[i];
        return m1;
      };
      return { inputs: { in: inG, cutoff: cvIn, key: keyIn, cutoff2: cv2In }, outputs: { out }, response, set: apply, destroy() { disconnectAll(inG, clean, pre, sat, post, mid, f1, f2, direct, steep, out, cvIn, keyIn, cv2In, ladG); if (lad) lad.disconnect(); } };
    }
  },

  vca: {
    name: 'VCA', hp: 6, accent: '#56b870',
    info: {
      title: 'VCA · Voltage-Controlled Amplifier',
      text: 'A VCA (Voltage-Controlled Amplifier) is a volume knob that a cable can turn. Sound goes in at In, and the signal at CV decides how much of it comes out. With nothing at CV and Level at zero, the VCA is closed: silence. That is why a synth is quiet until you press a key.',
      tryThis: 'Patch an ADSR into CV, then play. Now turn Level up: the VCA stays partly open and the sound drones even without a key.'
    },
    controls: [
      { id: 'level', label: 'Level', min: 0, max: 1, def: 0, info: 'Opens the VCA by hand. At 0 the VCA is fully closed unless a CV opens it.' },
      { id: 'cv', label: 'CV Amt', full: 'CV Amount', min: 0, max: 1, def: 1, info: 'How much the CV input opens the VCA.' },
      { id: 'resp', label: 'Response', expert: true, type: 'select', options: ['exp', 'lin'], labels: ['Exp', 'Lin'], def: 'exp', legacy: 'lin', info: 'How the CV turns into loudness. Exp (exponential): small CV values stay quiet and the sound swells in more naturally, like analog amplifiers and like your ears hear loudness. Lin (linear): loudness follows the CV in a straight line. Patches made before this switch existed use Lin.' }
    ],
    inputs: [
      { id: 'in', label: 'In', kind: 'signal', info: 'The sound whose volume is controlled.' },
      { id: 'cv', label: 'CV', kind: 'signal', info: 'CV means Control Voltage: a signal that controls something instead of being heard. Here it opens the VCA. An ADSR here gives every note a shape; an LFO here gives tremolo.' }
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'follow:in', info: 'The sound at its controlled volume. Usually goes to the Output.' }],
    create(ctx, p) {
      const g = ctx.createGain(); g.gain.value = p.level;
      // CV path: below zero the VCA stays closed (an LFO cannot turn the sound upside down);
      // Exp squares the CV, so the VCA opens gently at first. The shaper's input -1..1 stands for CV -2..2.
      const cvIn = ctx.createGain(), half = ctx.createGain(), shaper = ctx.createWaveShaper();
      half.gain.value = 0.5; cvIn.gain.value = p.cv;
      cvIn.connect(half).connect(shaper).connect(g.gain);
      const curve = resp => {
        const c = new Float32Array(1025);
        for (let i = 0; i < c.length; i++) { const x = (i / 512 - 1) * 2; c[i] = x <= 0 ? 0 : resp === 'exp' ? x * x : x; }
        return c;
      };
      shaper.curve = curve(p.resp);
      return {
        inputs: { in: g, cv: cvIn }, outputs: { out: g },
        set(id, v) {
          if (id === 'resp') shaper.curve = curve(v);
          else (id === 'level' ? g.gain : cvIn.gain).setTargetAtTime(v, ctx.currentTime, 0.01);
        },
        destroy() { disconnectAll(g, cvIn, half, shaper); }
      };
    }
  },

  adsr: {
    name: 'ADSR', hp: 8, accent: '#56b870', led: 'out', display: 'envelope',
    info: {
      title: 'ADSR · Envelope (Attack, Decay, Sustain, Release)',
      text: 'An envelope draws the shape of a note over time. When the Gate turns ON it rises (Attack), falls a bit (Decay), and stays at a level (Sustain) while you hold the key. When the Gate turns OFF it fades back to zero (Release). The envelope makes no sound: it is a control signal you send to a VCA (loudness) or a VCF (brightness).',
      tryThis: 'Patch the ADSR into a VCA\'s CV. Long Attack = a soft violin-like swell. Zero Sustain and short Decay = a plucked string.'
    },
    controls: [
      { id: 'a', label: 'Attack', min: 0.001, max: 4, def: 0.01, curve: 'exp', unit: 's', info: 'Time to rise from zero to full when the Gate turns ON.' },
      { id: 'd', label: 'Decay', min: 0.005, max: 10, def: 0.3, curve: 'exp', unit: 's', info: 'Time to fall from full down to the Sustain level.' },
      { id: 's', label: 'Sustain', min: 0, max: 1, def: 0.6, info: 'The level held while the Gate stays ON. This is a level, not a time.' },
      { id: 'r', label: 'Release', min: 0.005, max: 10, def: 0.4, curve: 'exp', unit: 's', info: 'Time to fade back to zero after the Gate turns OFF.' },
      { id: 'shape', label: 'Curve', expert: true, type: 'select', options: ['exp', 'lin'], labels: ['Exp', 'Lin'], def: 'exp', legacy: 'lin', info: 'The shape of Decay and Release. Exp (exponential): falls fast at first, then slowly, like the envelopes of analog synths and like a plucked string fading out. Lin (linear): falls in a straight line, which sounds slower at first and then stops abruptly. Patches made before this switch existed use Lin.' }
    ],
    inputs: [{ id: 'gate', label: 'Gate', kind: 'gate', info: 'Starts the envelope when ON and releases it when OFF. Comes from a Keyboard or Sequencer.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'cv', info: 'The envelope shape as a control signal from 0 to 1. One output can feed several inputs, e.g. a VCA and a VCF at once.' }],
    create(ctx, p) {
      const src = ctx.createConstantSource(); src.offset.value = 0; src.start();
      const env = new Envelope(src.offset);
      // gate history, so the panel display can show which stage the envelope is in
      const gates = [];
      const onGate = (on, t) => {
        gates.push({ on, t }); if (gates.length > 8) gates.shift();
        const exp = p.shape === 'exp';
        on ? env.attack(t, p.a, p.d, p.s, exp) : env.release(t, p.r, exp);
      };
      return { inputs: { gate: onGate }, outputs: { out: src }, env, gates, set() {}, destroy() { src.stop(); disconnectAll(src); } };
    }
  },

  // Hand-clap envelope: a few very short spikes, then a longer tail (like the clap of a TR-808)
  clap: {
    name: 'Clap', hp: 6, accent: '#56b870', led: 'out',
    info: {
      title: 'Clap · Hand-clap envelope',
      text: 'A hand clap is not one hit but several: the hands of a group never meet at exactly the same moment. This envelope fires a few very short spikes in quick succession and then a longer tail. Like the ADSR it makes no sound: it is a control signal for a VCA that lets Noise through.',
      tryThis: 'Noise → VCF (BP, about 1 kHz) → VCA, and the Clap\'s Out into the VCA\'s CV. Set Claps to 1 and it is a plain noise hit; turn Spread up and the clappers get sloppy.'
    },
    controls: [
      { id: 'claps', label: 'Claps', min: 1, max: 6, def: 4, step: 1, unit: 'n', info: 'How many spikes one Gate fires. The last one gets the long tail. 1 is a single noise hit, 3 to 5 sound like a group clapping.' },
      { id: 'spread', label: 'Spread', min: 0.003, max: 0.04, def: 0.011, curve: 'exp', unit: 's', info: 'The time between the spikes. Around 10 ms (milliseconds) is tight, like a drum machine. Longer sounds like a loose group of people; very long becomes a flam, separate hits.' },
      { id: 'decay', label: 'Decay', min: 0.03, max: 1.5, def: 0.25, curve: 'exp', unit: 's', info: 'How long the tail after the last spike rings out: short is a dry clap, long sounds like a clap in a hall.' }
    ],
    inputs: [{ id: 'gate', label: 'Gate', kind: 'gate', info: 'Each time the Gate turns ON the clap fires once. When it turns OFF nothing happens: a clap always plays to the end.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'cv', info: 'The clap shape as a control signal from 0 to 1. Patch it into a VCA\'s CV.' }],
    create(ctx, p) {
      const src = ctx.createConstantSource(); src.offset.value = 0; src.start();
      const g = src.offset;
      const onGate = (on, t) => {
        if (!on) return;
        const n = Math.max(1, Math.min(6, Math.round(p.claps || 1))), sp = p.spread;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
        for (let i = 0; i < n; i++) {
          const ti = t + i * sp, last = i === n - 1;
          // every spike jumps to full and falls fast; the last one falls slowly (98% gone after Decay)
          g.setValueAtTime(1, ti);
          g.setTargetAtTime(0, ti, last ? Math.max(0.005, p.decay / 4) : sp / 4);
        }
      };
      return { inputs: { gate: onGate }, outputs: { out: src }, set() {}, destroy() { src.stop(); disconnectAll(src); } };
    }
  },

  lfo: {
    name: 'LFO', hp: 6, accent: '#a46be0', led: 'out', display: 'roll',
    info: {
      title: 'LFO · Low-Frequency Oscillator',
      text: 'An LFO is an oscillator that is too slow to hear, typically between a few seconds per cycle and about twenty cycles per second. Instead of listening to it, you use it to move other knobs automatically, over and over. This is called modulation.',
      tryThis: 'Patch the LFO into a VCF\'s Cutoff input: wah-wah. Into a VCO\'s FM input with low Depth: vibrato. Into a VCA\'s CV: tremolo.'
    },
    controls: [
      { id: 'wave', label: 'Wave', type: 'select', options: LFO_WAVES, labels: LFO_WAVE_LABELS, icons: true, def: 'sine', info: 'The shape of the movement, drawn on the button. Tap to switch. Sine (smooth curve): glides up and down. Triangle (zigzag): moves up and down at a steady speed. Saw (rise, then drop): rises slowly, falls back at once. Square (high/low): jumps between two values. Smooth random (wandering line): drifts to a new random value each cycle, like an old analog synth going slightly out of tune. Sample & hold (random steps): jumps to a new random value each cycle and stays there.' },
      { id: 'rate', label: 'Rate', min: 0.05, max: 20, def: 2, curve: 'exp', unit: 'Hz', info: 'Speed: how many cycles per second.' },
      { id: 'depth', label: 'Depth', min: 0, max: 1, def: 0.5, info: 'How big the movement is. Small values give subtle effects.' },
      { id: 'fade', label: 'Fade', expert: true, min: 0, max: 5, def: 0, curve: 'exp', unit: 's', info: 'Needs a cable at Reset. After every Reset the movement starts at zero and grows to full Depth over this time: a vibrato that sets in only when a note is held, like a singer.' }
    ],
    inputs: [{ id: 'reset', label: 'Reset', kind: 'gate', info: 'A Gate here (for example from the Keyboard) restarts the wave at the beginning of its cycle on every note, so every note gets the same movement (key sync). With Fade the movement grows in after each note. Patched from a Keyboard with several Voices, every voice gets its own LFO.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'cv', info: 'The slow wave, swinging between minus and plus Depth. Patch it into any CV input.' }],
    create(ctx, p) {
      // regular shapes come from an oscillator; the two random shapes are scheduled from JS
      let osc = ctx.createOscillator(); osc.frequency.value = p.rate; osc.start();
      const rnd = ctx.createConstantSource(); rnd.offset.value = 0; rnd.start();
      const oscG = ctx.createGain(), rndG = ctx.createGain(), out = ctx.createGain();
      osc.connect(oscG).connect(out); rnd.connect(rndG).connect(out); out.gain.value = p.depth;
      // Reset (key sync): a new oscillator starts its cycle at the gate; Fade grows the depth back in
      const onReset = (on, t) => {
        if (!on) return;
        if (p.wave !== 'random' && p.wave !== 'sh') {
          const o = ctx.createOscillator(); o.type = osc.type; o.frequency.value = p.rate; o.connect(oscG); o.start(t);
          osc.stop(t); const old = osc; setTimeout(() => old.disconnect(), Math.max(0, (t - ctx.currentTime) * 1000) + 100);
          osc = o;
        }
        if (p.fade > 0.001) { out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(p.depth, t + p.fade); }
      };
      let timer = null, next = 0;
      const random = () => p.wave === 'random' || p.wave === 'sh';
      const tick = () => {
        while (next < ctx.currentTime + 0.15) {
          const v = Math.random() * 2 - 1, per = 1 / p.rate;
          if (p.wave === 'sh') rnd.offset.setValueAtTime(v, next); else rnd.offset.linearRampToValueAtTime(v, next + per);
          next += per;
        }
      };
      const shape = () => {
        const t = ctx.currentTime;
        oscG.gain.setValueAtTime(random() ? 0 : 1, t); rndG.gain.setValueAtTime(random() ? 1 : 0, t);
        if (!random()) osc.type = p.wave;
        if (random() && !timer) { rnd.offset.cancelScheduledValues(t); rnd.offset.setValueAtTime(rnd.offset.value, t); next = t; tick(); timer = setInterval(tick, 40); }
        if (!random() && timer) { clearInterval(timer); timer = null; }
      };
      shape();
      return {
        inputs: { reset: onReset }, outputs: { out },
        set(id, v) {
          if (id === 'wave') shape();
          else if (id === 'rate') osc.frequency.setTargetAtTime(v, ctx.currentTime, 0.01);
          else if (id === 'depth') out.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
        },
        destroy() { clearInterval(timer); osc.stop(); rnd.stop(); disconnectAll(osc, rnd, oscG, rndG, out); }
      };
    }
  },

  arp: {
    name: 'Arp', hp: 8, accent: '#f2c14e',
    info: {
      title: 'Arp · Arpeggiator',
      text: 'An arpeggiator plays the notes of a chord one after another instead of all at once. Hold a few keys on the keyboard at the bottom and the Arp steps through them in the order you choose, in time with its Tempo. Like the Keyboard and the Sequencer, it sends a Pitch and a Gate.',
      tryThis: 'Turn Hold on, press three or four keys and let go: the Arp keeps playing. Then try the different modes.'
    },
    controls: [
      { id: 'mode', label: 'Mode', type: 'select', options: ['up', 'down', 'updown', 'downup', 'random', 'walk'], labels: ['↑', '↓', '↑↓', '↓↑', '?', '~'], def: 'up', info: 'The order of the notes. ↑ up: lowest to highest. ↓ down: highest to lowest. ↑↓ up and back down. ↓↑ down and back up (the top and bottom note are not repeated at the turn). ? random order. ~ random walk: each note is a neighbour of the last one, one step up or down by chance.' },
      { id: 'oct', label: 'Octaves', min: 1, max: 3, def: 1, step: 1, unit: 'n', info: 'Spreads the chord over 1, 2 or 3 octaves: the pattern plays the held notes, then the same notes one octave higher, and so on.' },
      { id: 'tempo', label: 'Tempo', min: 40, max: 240, def: 110, step: 1, unit: 'bpm', info: 'Speed in BPM (beats per minute).' },
      { id: 'div', label: 'Speed', type: 'select', options: ['1/8', '1/16', '1/32'], labels: ['1/8', '1/16', '1/32'], def: '1/16', info: 'How many notes per beat: 1/8 plays two, 1/16 four, 1/32 eight.' },
      { id: 'len', label: 'Length', expert: true, min: 0.05, max: 0.95, def: 0.5, info: 'How long each Gate stays ON, as a part of one note.' },
      { id: 'offset', label: 'Start', min: 0, max: 3, def: 0, step: 1, unit: 'n', info: 'Which chord note the pattern starts on: 0 is the lowest note, 1 the second lowest, and so on.' },
      { id: 'hold', label: 'Hold', type: 'toggle', def: 0, info: 'When on, the Arp keeps playing after you let go of the keys. The next chord you press replaces the old one.' }
    ],
    inputs: [{ id: 'clock', label: 'Clock', kind: 'gate', info: 'Patch a Clock module here and every pulse plays the next note; Tempo and Speed are then ignored. Keeps the Arp in time with Sequencers on the same Clock.' }],
    outputs: [
      { id: 'pitch', label: 'Pitch', kind: 'signal', sig: 'pitch', info: 'The note the Arp is playing right now. Patch it into a VCO\'s Pitch input.' },
      { id: 'gate', label: 'Gate', kind: 'gate', info: 'ON for every arpeggiated note. Patch it into an ADSR\'s Gate input.' }
    ],
    create(ctx, p) {
      const pitch = ctx.createConstantSource(); pitch.offset.value = 0; pitch.start();
      const gate = new GateOut();
      const held = [];                                   // keys down right now
      let latched = Array.isArray(p.notes) ? [...p.notes] : []; // chord kept by Hold (also stored in the patch)
      let timer = null, next = 0, idx = 0;
      const chord = () => {
        const c = [...(held.length ? held : p.hold ? latched : [])].sort((a, b) => a - b), all = [];
        for (let o = 0; o < Math.max(1, Math.round(p.oct || 1)); o++) c.forEach(n => all.push(n + 12 * o));
        return all;
      };
      let walkPos = 0;
      const pattern = c => {
        if (c.length < 3) return p.mode === 'down' || p.mode === 'downup' ? [...c].reverse() : c;
        switch (p.mode) {
          case 'down': return [...c].reverse();
          case 'updown': return [...c, ...c.slice(1, -1).reverse()];
          case 'downup': return [...[...c].reverse(), ...c.slice(1, -1)];
          default: return c;
        }
      };
      const stepDur = () => 60 / p.tempo / ({ '1/8': 2, '1/16': 4, '1/32': 8 }[p.div] || 4);
      let lastClock = -10;
      // one arpeggio note at time t, lasting dur seconds
      const playAt = (t, dur) => {
        const c = chord(); if (!c.length) return false;
        const pat = pattern(c);
        if (p.mode === 'walk') walkPos = Math.max(0, Math.min(c.length - 1, walkPos + (Math.random() < 0.5 ? -1 : 1)));
        const note = p.mode === 'random' ? c[Math.floor(Math.random() * c.length)] : p.mode === 'walk' ? c[walkPos] : pat[idx % pat.length];
        pitch.offset.setValueAtTime((note - 48) / 12, t);
        gate.emit(true, t); gate.emit(false, t + dur * p.len);
        idx++; return true;
      };
      const onClock = (on, t) => {
        if (!on) return;
        const d = lastClock > 0 && t - lastClock < 2 ? t - lastClock : stepDur();
        lastClock = t; playAt(t, d);
      };
      const tick = () => {
        if (ctx.currentTime - lastClock < 1) { next = ctx.currentTime + 0.03; return; } // an external Clock drives the notes
        while (next < ctx.currentTime + 0.12) {
          const c = chord(); if (!c.length) { stop(); return; }
          const pat = pattern(c);
          if (p.mode === 'walk') walkPos = Math.max(0, Math.min(c.length - 1, walkPos + (Math.random() < 0.5 ? -1 : 1)));
          const note = p.mode === 'random' ? c[Math.floor(Math.random() * c.length)] : p.mode === 'walk' ? c[walkPos] : pat[idx % pat.length];
          pitch.offset.setValueAtTime((note - 48) / 12, next);
          gate.emit(true, next); gate.emit(false, next + stepDur() * p.len);
          idx++; next += stepDur();
        }
      };
      const start = () => {
        if (timer) return;
        const c = chord(); if (!c.length) return;
        idx = Math.max(0, pattern(c).indexOf(c[Math.min(p.offset, c.length - 1)]));
        next = ctx.currentTime + 0.03; tick(); timer = setInterval(tick, 25);
      };
      function stop() { if (timer) { clearInterval(timer); timer = null; } gate.emit(false, ctx.currentTime); }
      if (p.hold && latched.length) start();
      return {
        inputs: { clock: onClock }, outputs: { pitch, gate },
        noteOn(n) {
          if (!held.length && p.hold) latched = [];       // a new chord after letting go replaces the old one
          if (!held.includes(n)) held.push(n);
          if (p.hold && !latched.includes(n)) latched.push(n);
          p.notes = [...latched];
          start();
        },
        noteOff(n) {
          const i = held.indexOf(n); if (i >= 0) held.splice(i, 1);
          if (!held.length && !p.hold) stop();
        },
        allOff() { held.length = 0; if (!p.hold) stop(); },
        set(id, v) { if (id === 'hold') { if (v && latched.length) start(); if (!v && !held.length) stop(); } },
        destroy() { stop(); pitch.stop(); disconnectAll(pitch); }
      };
    }
  },

  mixer: {
    name: 'Mixer', hp: 8, accent: '#9aa0a6',
    info: {
      title: 'Mixer',
      text: 'A mixer adds several signals together into one, each with its own level knob. Mix two VCOs for a fatter sound, or a VCO and Noise for a breathy one. It works for control signals too: mix an LFO and an ADSR to move a filter with both.',
      tryThis: 'Mix two VCOs one octave apart, then detune one with its Fine knob.'
    },
    controls: [
      ...[1, 2, 3].map(i => ({ id: 'l' + i, label: 'Level ' + i, min: -1, max: 1, def: 0.8, info: 'Volume of input ' + i + '. Turned below the middle it becomes negative and turns the signal upside down (inverts it): with control signals that subtracts, for example "the filter closes while the LFO rises".' })),
      { id: 'out', label: 'Out', min: 0, max: 1, def: 1, info: 'The level of the whole mix. Turn it down when several loud signals add up to too much.' }
    ],
    inputs: [1, 2, 3].map(i => ({ id: 'in' + i, label: 'In ' + i, kind: 'signal', info: 'Input ' + i + ': any signal.' })),
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'follow:in1,in2,in3', info: 'The sum of all inputs.' }],
    create(ctx, p) {
      const out = ctx.createGain(); out.gain.value = p.out ?? 1;
      const ins = [1, 2, 3].map(i => { const g = ctx.createGain(); g.gain.value = p['l' + i]; g.connect(out); return g; });
      return {
        inputs: { in1: ins[0], in2: ins[1], in3: ins[2] }, outputs: { out },
        set(id, v) { (id === 'out' ? out : ins[+id[1] - 1]).gain.setTargetAtTime(v, ctx.currentTime, 0.01); },
        destroy() { disconnectAll(out, ...ins); }
      };
    }
  },

  delay: {
    name: 'Delay', hp: 6, accent: '#2fc4c4',
    info: {
      title: 'Delay',
      text: 'A delay records what comes in and plays it back a moment later, like an echo in a canyon. Feedback sends the echo back into the delay, so you hear several repeats that get quieter each time. Short, rhythmic delays turn a simple sequence into a groove.',
      tryThis: 'Run a Sequencer and set Time to half of one step: the echoes land exactly between the notes and the line starts to "gallop".'
    },
    controls: [
      { id: 'time', label: 'Time', min: 0.02, max: 1, def: 0.25, curve: 'exp', unit: 's', info: 'How long until the echo comes back. Set it in relation to the tempo for rhythmic echoes.' },
      { id: 'fb', label: 'Feedback', min: 0, max: 0.9, def: 0.3, info: 'How much of the echo is fed back in. Low = one or two repeats, high = a long trail of echoes.' },
      { id: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, info: 'How loud the echoes are compared to the original sound.' },
      { id: 'sync', label: 'Sync', expert: true, type: 'select', options: ['free', '1/4', '1/8.', '1/8', '1/16'], labels: ['Free', '1/4', '1/8.', '1/8', '1/16'], def: 'free', info: 'Free: the Time knob sets the echo. Otherwise the echo is a note length at the BPM (beats per minute) set next to it: 1/4 one beat, 1/8. a dotted eighth (the classic rhythmic echo of 80s rock guitar), 1/8 half a beat, 1/16 a quarter of a beat.' },
      { id: 'bpm', label: 'BPM', expert: true, min: 40, max: 240, def: 120, step: 1, unit: 'bpm', info: 'The tempo for Sync. Set it to the tempo of your Sequencer or Arp.' },
      { id: 'tone', label: 'Tone', expert: true, min: 800, max: 16000, def: 16000, curve: 'exp', unit: 'Hz', info: 'Darkens every repeat a little more, like tape echo or analog delays. Fully up, the echoes stay as bright as the original.' }
    ],
    inputs: [{ id: 'in', label: 'In', kind: 'signal', info: 'The sound to echo.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'follow:in', info: 'The original sound plus its echoes.' }],
    create(ctx, p) {
      const inG = ctx.createGain(), out = ctx.createGain();
      const d = ctx.createDelay(2);
      const fb = ctx.createGain(); fb.gain.value = p.fb;
      const wet = ctx.createGain(); wet.gain.value = p.mix;
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = -3; tone.frequency.value = p.tone ?? 16000;
      inG.connect(out); inG.connect(d); d.connect(tone).connect(fb).connect(d); d.connect(wet).connect(out);
      const NOTE = { '1/4': 1, '1/8.': 0.75, '1/8': 0.5, '1/16': 0.25 };
      const time = () => (p.sync && p.sync !== 'free' ? Math.min(2, 60 / p.bpm * NOTE[p.sync]) : p.time);
      d.delayTime.value = time();
      return {
        inputs: { in: inG }, outputs: { out },
        set(id, v) {
          const t = ctx.currentTime;
          if (id === 'time' || id === 'sync' || id === 'bpm') d.delayTime.setTargetAtTime(time(), t, 0.02);
          else if (id === 'tone') tone.frequency.setTargetAtTime(v, t, 0.02);
          else (id === 'fb' ? fb : wet).gain.setTargetAtTime(v, t, 0.01);
        },
        destroy() { disconnectAll(inG, d, tone, fb, wet, out); }
      };
    }
  },

  chorus: {
    name: 'Chorus', hp: 6, accent: '#2fc4c4',
    info: {
      title: 'Chorus',
      text: 'A chorus copies the sound twice, delays each copy by a few milliseconds and keeps that delay slowly moving. The copies drift slightly out of tune against the original, like several players playing the same part. One copy goes left, one right, so the sound becomes wide and shimmering.',
      tryThis: 'Put it after an e-piano or a pad, then turn Depth from 0 up: the sound grows from narrow to wide and wobbly. Use headphones to hear the stereo width.'
    },
    controls: [
      { id: 'rate', label: 'Rate', min: 0.05, max: 6, def: 0.8, curve: 'exp', unit: 'Hz', info: 'How fast the copies drift. Slow (under 1 Hz, one cycle per second) is lush; fast sounds wobbly, like a Leslie (the rotating speaker of an organ).' },
      { id: 'depth', label: 'Depth', min: 0, max: 1, def: 0.5, info: 'How far the copies drift out of tune. Higher values are more obvious and "seasick".' },
      { id: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, info: 'How loud the drifting copies are compared to the original.' },
      { id: 'mode', label: 'Mode', expert: true, type: 'select', options: ['I', 'II', 'I+II'], labels: ['I', 'II', 'I+II'], def: 'I',
        presets: { I: { rate: 0.8, depth: 0.5 }, II: { rate: 0.5, depth: 0.75 }, 'I+II': { rate: 1.6, depth: 0.25 } },
        info: 'Three tried and tested settings, like the buttons of classic ensemble choruses: I is gentle (the starting setting), II is slower and deeper, I+II is a fast, shallow shimmer. Choosing one sets Rate and Depth; you can still turn them afterwards.' },
      { id: 'hicut', label: 'Hi Cut', expert: true, min: 2000, max: 20000, def: 7000, legacy: 20000, curve: 'exp', unit: 'Hz', info: 'Takes the highest frequencies out of the drifting copies, as in analog choruses. That keeps the effect warm instead of thin and fizzy, especially on bright FM sounds. Patches made before this knob existed have it fully up.' }
    ],
    inputs: [{ id: 'in', label: 'In', kind: 'signal', info: 'The sound to thicken.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'follow:in', info: 'The original in the middle plus the two drifting copies left and right (stereo).' }],
    create(ctx, p) {
      const inG = ctx.createGain(), out = ctx.createGain(), wet = ctx.createGain(), hic = ctx.createBiquadFilter();
      hic.type = 'lowpass'; hic.Q.value = -3; hic.frequency.value = p.hicut ?? 20000;
      wet.gain.value = p.mix; inG.connect(out); hic.connect(wet).connect(out);
      const voices = [[-1, 0.012, 0], [1, 0.017, Math.PI]].map(([pan, base, phase]) => {
        const d = ctx.createDelay(0.05); d.delayTime.value = base;
        const lfo = ctx.createOscillator(); lfo.frequency.value = p.rate;
        if (phase) { // second voice moves opposite to the first
          const real = new Float32Array([0, 0]), imag = new Float32Array([0, -1]);
          lfo.setPeriodicWave(ctx.createPeriodicWave(real, imag));
        }
        const amt = ctx.createGain(); amt.gain.value = p.depth * 0.004;
        lfo.connect(amt).connect(d.delayTime); lfo.start();
        const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
        if (pn.pan) pn.pan.value = pan;
        inG.connect(d); d.connect(pn).connect(hic);
        return { d, lfo, amt, pn };
      });
      return {
        inputs: { in: inG }, outputs: { out },
        set(id, v) {
          const t = ctx.currentTime;
          if (id === 'mix') wet.gain.setTargetAtTime(v, t, 0.01);
          if (id === 'hicut') hic.frequency.setTargetAtTime(v, t, 0.02);
          for (const x of voices) {
            if (id === 'rate') x.lfo.frequency.setTargetAtTime(v, t, 0.02);
            if (id === 'depth') x.amt.gain.setTargetAtTime(v * 0.004, t, 0.02);
          }
        },
        destroy() { voices.forEach(x => { x.lfo.stop(); disconnectAll(x.d, x.lfo, x.amt, x.pn); }); disconnectAll(inG, hic, wet, out); }
      };
    }
  },

  reverb: {
    name: 'Reverb', hp: 6, accent: '#2fc4c4',
    info: {
      title: 'Reverb',
      text: 'Reverb imitates a room. In a real hall, a sound bounces off walls, floor and ceiling thousands of times and fades away slowly. This module adds that tail of reflections, so a dry synth sounds like it is playing in a space.',
      tryThis: 'Play short notes and turn Size up: the room grows from a small studio to a cathedral. Turn Tone down for a darker, softer room.'
    },
    controls: [
      { id: 'size', label: 'Size', min: 0.3, max: 6, def: 1.8, curve: 'exp', unit: 's', info: 'How long the reverb tail lasts. Small room: under 1 s. Large hall: 2–3 s. Cathedral: more.' },
      { id: 'tone', label: 'Tone', min: 800, max: 14000, def: 5000, curve: 'exp', unit: 'Hz', info: 'Brightness of the reflections. Real rooms swallow high frequencies, so a lower Tone sounds more natural and less harsh.' },
      { id: 'mix', label: 'Mix', min: 0, max: 1, def: 0.3, info: 'How loud the room is compared to the original sound. A little goes a long way.' },
      { id: 'type', label: 'Type', type: 'select', options: ['room', 'plate', 'spring'], labels: ['Room', 'Plate', 'Spring'], def: 'room', info: 'Room: the reflections of a real space. Plate: a big metal plate made to vibrate, as in 70s and 80s studios: dense, bright and smooth. Spring: a metal spring in a box, as in guitar amps and early synths: boingy and splashy, the sound of Oxygène.' },
      { id: 'pre', label: 'Pre-delay', expert: true, min: 0, max: 0.2, def: 0, unit: 's', info: 'A short pause before the room answers. In a big hall the first reflections arrive late; a pre-delay of 20–60 ms keeps the start of every note clear even with lots of reverb.' }
    ],
    inputs: [{ id: 'in', label: 'In', kind: 'signal', info: 'The sound to put in a room.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'follow:in', info: 'The original plus the reverb tail (stereo).' }],
    create(ctx, p) {
      const inG = ctx.createGain(), out = ctx.createGain(), wet = ctx.createGain();
      const pre = ctx.createDelay(0.25), tone = ctx.createBiquadFilter();
      pre.delayTime.value = p.pre || 0;
      tone.type = 'lowpass'; tone.frequency.value = p.tone; wet.gain.value = p.mix;
      inG.connect(out); inG.connect(pre); tone.connect(wet).connect(out);
      // impulse response: decaying stereo noise, a simple synthetic room
      const ir = secs => {
        const len = Math.round(ctx.sampleRate * secs), b = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = b.getChannelData(c);
          if (p.type === 'plate') for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * i / len) * Math.min(1, i / (0.004 * ctx.sampleRate));
          else for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
        }
        return b;
      };
      // M1-9: a new Size gets its own convolver; the old room fades out while the new one fades in, so the tail never breaks off
      let cur = null;
      const build = secs => {
        const conv = ctx.createConvolver(), g = ctx.createGain(), t = ctx.currentTime;
        conv.buffer = ir(secs); pre.connect(conv).connect(g).connect(tone);
        if (cur) {
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.25);
          const old = cur; old.g.gain.setValueAtTime(1, t); old.g.gain.linearRampToValueAtTime(0, t + 0.25);
          setTimeout(() => disconnectAll(old.conv, old.g), Math.max(400, secs * 1000));
        }
        cur = { conv, g };
      };
      build(p.size);
      // M3-5 spring: all-pass filters in a feedback loop smear every echo in time: the "boing" of a spring
      const spIn = ctx.createGain(), spOut = ctx.createGain(), spDl = ctx.createDelay(0.2), spFb = ctx.createGain(), spLp = ctx.createBiquadFilter();
      const aps = [1100, 1400, 1700, 2000, 2300, 2600, 2900, 3300].map(f => { const a = ctx.createBiquadFilter(); a.type = 'allpass'; a.frequency.value = f; a.Q.value = 0.5; return a; });
      pre.connect(spIn); aps.reduce((x, a) => x.connect(a), spIn); aps[aps.length - 1].connect(spDl);
      spDl.delayTime.value = 0.037; spLp.type = 'lowpass'; spLp.frequency.value = 4200;
      spDl.connect(spLp).connect(spFb).connect(aps[0]); spLp.connect(spOut).connect(tone);
      const route = () => {
        const t = ctx.currentTime, spring = p.type === 'spring';
        spIn.gain.setTargetAtTime(spring ? 1 : 0, t, 0.01); spOut.gain.setTargetAtTime(spring ? 1.6 : 0, t, 0.01);
        spFb.gain.setTargetAtTime(Math.min(0.9, 0.5 + p.size * 0.07), t, 0.02);
        if (cur) cur.g.gain.setTargetAtTime(spring ? 0 : 1, t, 0.01);
      };
      route();
      let timer = null;
      return {
        inputs: { in: inG }, outputs: { out },
        set(id, v) {
          const t = ctx.currentTime;
          if (id === 'size' || id === 'type') { clearTimeout(timer); timer = setTimeout(() => { if (p.type !== 'spring') build(p.size); route(); }, 120); }
          if (id === 'tone') tone.frequency.setTargetAtTime(v, t, 0.02);
          if (id === 'mix') wet.gain.setTargetAtTime(v, t, 0.01);
          if (id === 'pre') pre.delayTime.setTargetAtTime(v, t, 0.02);
        },
        destroy() { clearTimeout(timer); disconnectAll(inG, pre, cur.conv, cur.g, tone, wet, out, spIn, spOut, spDl, spFb, spLp, ...aps); }
      };
    }
  },

  // M3-6: any signal becomes a Gate
  trigger: {
    name: 'Trigger', hp: 6, accent: '#f2c14e',
    info: {
      title: 'Trigger',
      text: 'Turns any signal into a Gate. While the signal at In is above the Threshold, the Gate is ON; when it falls below, it is OFF. That lets an LFO clock a Sequencer, a VCO start envelopes, or a slow random wave play notes at random times.',
      tryThis: 'Patch an LFO (Square) into In and Out into an ADSR\'s Gate: the envelope fires on its own, at the LFO\'s Rate.'
    },
    controls: [
      { id: 'thr', label: 'Threshold', min: -1, max: 1, def: 0, info: 'The level the signal must rise above for the Gate to turn ON. With a Sine LFO, a higher Threshold makes shorter Gates.' }
    ],
    inputs: [{ id: 'in', label: 'In', kind: 'signal', info: 'Any signal: an LFO, an envelope, a VCO, noise.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'gate', info: 'ON while the signal is above the Threshold. Patch into an ADSR Gate, a Sequencer Clock or an LFO Reset.' }],
    create(ctx, p) {
      const inG = ctx.createGain(), gate = new GateOut();
      if (ctx.__mssWorklet) {
        const node = new AudioWorkletNode(ctx, 'mss-trigger', { numberOfInputs: 1, numberOfOutputs: 0 });
        inG.connect(node); node.parameters.get('thr').value = p.thr;
        node.port.onmessage = e => gate.emit(!!e.data[0], Math.max(e.data[1], ctx.currentTime));
        return { inputs: { in: inG }, outputs: { out: gate }, set(id, v) { node.parameters.get('thr').setValueAtTime(v, ctx.currentTime); },
          destroy() { node.port.onmessage = null; disconnectAll(inG, node); } };
      }
      // fallback: look at the signal every 10 ms (less exact timing)
      const an = ctx.createAnalyser(); an.fftSize = 256; inG.connect(an);
      const buf = new Float32Array(256); let on = false;
      const timer = setInterval(() => { an.getFloatTimeDomainData(buf); const v = buf[255]; if (!on && v > p.thr + 0.02) { on = true; gate.emit(true, ctx.currentTime); } else if (on && v < p.thr - 0.02) { on = false; gate.emit(false, ctx.currentTime); } }, 10);
      return { inputs: { in: inG }, outputs: { out: gate }, set() {}, destroy() { clearInterval(timer); disconnectAll(inG, an); } };
    }
  },

  // ---------- M4: utilities and new sound sources ----------
  atten: {
    name: 'Atten', hp: 6, accent: '#9aa0a6',
    info: {
      title: 'Atten · Attenuverter and Multiple',
      text: 'Two small tools in one. Each channel scales a signal: at +1 it passes unchanged, at 0.5 it is half as strong, at 0 it is gone, and below 0 it is turned upside down (inverted). Each channel also has two outputs carrying the same signal, so one signal can go to two places (a multiple). A control signal is just a voltage: you can make it smaller, bigger or upside down before it moves a knob.',
      tryThis: 'Patch an ADSR through channel 1 into a VCF Cutoff and turn Amt 1 below zero: now every note starts dark and opens up.'
    },
    controls: [
      { id: 'a1', label: 'Amt 1', full: 'Amount 1', min: -1, max: 1, def: 1, info: 'How much of the signal at In 1 reaches Out 1. Below the middle it is inverted.' },
      { id: 'a2', label: 'Amt 2', full: 'Amount 2', min: -1, max: 1, def: 1, info: 'How much of the signal at In 2 reaches Out 2. Below the middle it is inverted.' }
    ],
    inputs: [
      { id: 'in1', label: 'In 1', kind: 'signal', info: 'Signal for channel 1.' },
      { id: 'in2', label: 'In 2', kind: 'signal', info: 'Signal for channel 2.' }
    ],
    outputs: [
      { id: 'o1', label: 'Out 1', kind: 'signal', sig: 'follow:in1', info: 'Channel 1, scaled by Amt 1.' },
      { id: 'o1b', label: 'Out 1', kind: 'signal', sig: 'follow:in1', info: 'The same as the other Out 1: a second copy (multiple).' },
      { id: 'o2', label: 'Out 2', kind: 'signal', sig: 'follow:in2', info: 'Channel 2, scaled by Amt 2.' },
      { id: 'o2b', label: 'Out 2', kind: 'signal', sig: 'follow:in2', info: 'The same as the other Out 2: a second copy (multiple).' }
    ],
    create(ctx, p) {
      const g1 = ctx.createGain(), g2 = ctx.createGain(); g1.gain.value = p.a1; g2.gain.value = p.a2;
      return { inputs: { in1: g1, in2: g2 }, outputs: { o1: g1, o1b: g1, o2: g2, o2b: g2 },
        set(id, v) { (id === 'a1' ? g1 : g2).gain.setTargetAtTime(v, ctx.currentTime, 0.01); }, destroy() { disconnectAll(g1, g2); } };
    }
  },

  sh: {
    name: 'S&H', hp: 4, accent: '#a46be0',
    info: {
      title: 'S&H · Sample and Hold',
      text: 'Every time a Gate arrives, Sample and Hold takes the value of the signal at In at that moment and holds it until the next Gate: a smooth or noisy signal becomes a staircase of steps. Set to Random it takes a random value each time instead: the classic random bleeps of science fiction.',
      tryThis: 'Patch a Clock or Sequencer Gate into Gate and Out into a VCO\'s Pitch (through an Atten set to about 0.3): random melodies. Add a Quantizer to keep them in key.'
    },
    controls: [
      { id: 'src', label: 'Source', type: 'select', options: ['rand', 'in'], labels: ['Random', 'In'], def: 'rand', info: 'Random: every Gate takes a new random value (the In jack is ignored). In: every Gate takes the value of the signal at In.' }
    ],
    inputs: [
      { id: 'in', label: 'In', kind: 'signal', info: 'The signal to sample when Source is set to In.' },
      { id: 'gate', label: 'Gate', kind: 'gate', info: 'Each Gate takes a new sample.' }
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'cv', info: 'The held value: a new step at every Gate.' }],
    create(ctx, p) {
      const inG = ctx.createGain(), out = ctx.createGain();
      if (ctx.__mssWorklet) {
        const node = new AudioWorkletNode(ctx, 'mss-sh', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        inG.connect(node); node.connect(out);
        return { inputs: { in: inG, gate: (on, t) => node.port.postMessage({ on, t, rand: p.src !== 'in' }) }, outputs: { out }, set() {},
          destroy() { node.port.onmessage = null; disconnectAll(inG, node, out); } };
      }
      // fallback: sample on the main thread (timing within a few ms)
      const an = ctx.createAnalyser(); an.fftSize = 256; inG.connect(an);
      const hold = ctx.createConstantSource(); hold.offset.value = 0; hold.start(); hold.connect(out);
      const buf = new Float32Array(256);
      const onGate = (on, t) => { if (!on) return; setTimeout(() => { an.getFloatTimeDomainData(buf); const v = p.src === 'in' ? buf[255] : Math.random() * 2 - 1; hold.offset.setValueAtTime(v, ctx.currentTime); }, Math.max(0, (t - ctx.currentTime) * 1000)); };
      return { inputs: { in: inG, gate: onGate }, outputs: { out }, set() {}, destroy() { hold.stop(); disconnectAll(inG, an, hold, out); } };
    }
  },

  slew: {
    name: 'Slew', hp: 4, accent: '#a46be0',
    info: {
      title: 'Slew · Lag',
      text: 'Slows a signal down: the output follows the input, but can only rise and fall so fast. Steps become slides. On a Sequencer\'s Pitch it gives glide (portamento); on a random S&H it gives a smoothly wandering line; on a Gate it gives a simple envelope.',
      tryThis: 'Put Slew between a Sequencer\'s Pitch and the VCO, and turn Rise and Fall up a little.'
    },
    controls: [
      { id: 'rise', label: 'Rise', min: 0.001, max: 5, def: 0.1, curve: 'exp', unit: 's', info: 'How long a jump upward takes.' },
      { id: 'fall', label: 'Fall', min: 0.001, max: 5, def: 0.1, curve: 'exp', unit: 's', info: 'How long a jump downward takes.' }
    ],
    inputs: [{ id: 'in', label: 'In', kind: 'signal', info: 'The signal to slow down.' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'follow:in', info: 'The slowed-down signal.' }],
    create(ctx, p) {
      const inG = ctx.createGain(), out = ctx.createGain();
      if (ctx.__mssWorklet) {
        const node = new AudioWorkletNode(ctx, 'mss-slew', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        inG.connect(node).connect(out);
        const apply = () => { node.parameters.get('rise').setValueAtTime(p.rise, ctx.currentTime); node.parameters.get('fall').setValueAtTime(p.fall, ctx.currentTime); };
        apply();
        return { inputs: { in: inG }, outputs: { out }, set: apply, destroy() { disconnectAll(inG, node, out); } };
      }
      // fallback: a low-pass filter (rise and fall equal)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = -3;
      const apply = () => lp.frequency.setTargetAtTime(Math.min(1000, 1 / (2 * Math.PI * Math.max(0.001, (p.rise + p.fall) / 2) / 4)), ctx.currentTime, 0.01);
      apply(); inG.connect(lp).connect(out);
      return { inputs: { in: inG }, outputs: { out }, set: apply, destroy() { disconnectAll(inG, lp, out); } };
    }
  },

  ring: {
    name: 'Ring', hp: 4, accent: '#e2574c',
    info: {
      title: 'Ring · Ring Modulator',
      text: 'Multiplies two signals. Two tones multiplied give neither tone, but their sum and difference: metallic, bell-like, robotic sounds whose overtones are not in tune with each other. With a slow LFO at B it becomes a tremolo that flips the sound upside down.',
      tryThis: 'Patch two VCOs into A and B and detune one slowly: bells, then robots.'
    },
    controls: [],
    inputs: [
      { id: 'a', label: 'A', kind: 'signal', info: 'The first signal.' },
      { id: 'b', label: 'B', kind: 'signal', info: 'The second signal: A is multiplied by it.' }
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'follow:a', info: 'A times B.' }],
    create(ctx) {
      const g = ctx.createGain(); g.gain.value = 0; // gain 0 plus B: the output is A × B
      const b = ctx.createGain(); b.connect(g.gain);
      return { inputs: { a: g, b }, outputs: { out: g }, set() {}, destroy() { disconnectAll(g, b); } };
    }
  },

  fold: {
    name: 'Folder', hp: 6, accent: '#e2574c',
    info: {
      title: 'Folder · Wavefolder',
      text: 'A different way to make overtones. Instead of removing them with a filter, a wavefolder adds them: when the wave gets too big, it is folded back on itself, again and again. Turn Fold up on a sine and it grows from soft to bright and glassy. This is the "west coast" style of synthesis, after the Buchla synthesizers of the 1960s.',
      tryThis: 'Patch a Sine VCO into In, then move Fold with an ADSR (through an Atten): every note sweeps from soft to sparkling.'
    },
    controls: [
      { id: 'fold', label: 'Fold', min: 1, max: 8, def: 1, info: 'How much the wave is boosted before it folds. At 1 it passes almost unchanged; higher values fold it more often and make it brighter.' },
      { id: 'sym', label: 'Symmetry', min: -1, max: 1, def: 0, info: 'Shifts the wave up or down before folding, so it folds unevenly: adds a different, hollower set of overtones.' }
    ],
    inputs: [
      { id: 'in', label: 'In', kind: 'signal', info: 'The sound to fold. A sine or triangle works best.' },
      { id: 'cv', label: 'CV', kind: 'signal', info: 'Adds to the Fold amount: an envelope here makes the brightness move with every note.' }
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'follow:in', info: 'The folded sound.' }],
    create(ctx, p) {
      // the shaper's input -1..1 stands for -8..8; sin() folds the wave back each time it passes ±1
      const inG = ctx.createGain(), pre = ctx.createGain(), shaper = ctx.createWaveShaper(), out = ctx.createGain(), sym = ctx.createConstantSource(), cv = ctx.createGain();
      const c = new Float32Array(8193); for (let i = 0; i < c.length; i++) c[i] = Math.sin(Math.PI / 2 * ((i / 4096 - 1) * 8));
      shaper.curve = c; shaper.oversample = '4x';
      inG.connect(pre); sym.connect(pre); sym.start(); cv.gain.value = 1 / 8; cv.connect(pre.gain);
      pre.connect(shaper).connect(out);
      const apply = () => { const t = ctx.currentTime; pre.gain.setTargetAtTime(p.fold / 8, t, 0.01); sym.offset.setTargetAtTime(p.sym, t, 0.01); };
      apply();
      return { inputs: { in: inG, cv }, outputs: { out }, set: apply, destroy() { sym.stop(); disconnectAll(inG, pre, shaper, out, sym, cv); } };
    }
  },

  quant: {
    name: 'Quantizer', hp: 6, accent: '#56b870',
    info: {
      title: 'Quantizer',
      text: 'Snaps a pitch to the nearest note of a scale. Any signal that wanders (an LFO, a random S&H, your mod strip) becomes a melody that stays in key. Scale chooses which notes are allowed, Root which key it is in.',
      tryThis: 'Patch an S&H (random) through an Atten at about 0.3 into In, and Out into a VCO\'s Pitch: random melodies that always fit.'
    },
    controls: [
      { id: 'scale', label: 'Scale', type: 'select', options: ['chrom', 'major', 'minor', 'penta', 'blues'], labels: ['Chrom', 'Major', 'Minor', 'Penta', 'Blues'], def: 'major', info: 'Which notes are allowed. Chrom (chromatic): all twelve. Major: bright and happy. Minor: darker. Penta (pentatonic): five notes that always sound good together. Blues: the pentatonic with an extra bluesy note.' },
      { id: 'root', label: 'Root', min: 0, max: 11, def: 0, step: 1, unit: 'st', info: 'The key of the scale: C, C#, D and so on.' }
    ],
    inputs: [{ id: 'in', label: 'In', kind: 'signal', info: 'A pitch or any control signal (one unit = one octave).' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'pitch', info: 'The pitch snapped to the scale. Patch into a VCO\'s Pitch.' }],
    create(ctx, p) {
      // a staircase curve: the shaper's input -1..1 stands for -4..+4 octaves
      const SCALES = { chrom: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], penta: [0, 2, 4, 7, 9], blues: [0, 3, 5, 6, 7, 10] };
      const inG = ctx.createGain(), pre = ctx.createGain(), shaper = ctx.createWaveShaper(), post = ctx.createGain();
      pre.gain.value = 1 / 4; post.gain.value = 4; inG.connect(pre).connect(shaper).connect(post);
      const build = () => {
        const notes = [], sc = SCALES[p.scale] || SCALES.major;
        for (let o = -5; o <= 5; o++) for (const n of sc) notes.push(o * 12 + n + p.root);
        const c = new Float32Array(16385);
        for (let i = 0; i < c.length; i++) {
          const semis = (i / 8192 - 1) * 48;
          let best = notes[0]; for (const n of notes) if (Math.abs(n - semis) < Math.abs(best - semis)) best = n;
          c[i] = best / 12 / 4;
        }
        shaper.curve = c;
      };
      build();
      return { inputs: { in: inG }, outputs: { out: post }, set: build, destroy() { disconnectAll(inG, pre, shaper, post); } };
    }
  },

  dx: {
    name: 'DX', hp: 14, accent: '#e2574c',
    info: {
      title: 'DX · Six-operator FM voice',
      text: 'A complete FM voice in one module, for when you want the full Yamaha DX7 E.PIANO 1 structure without patching it: six sine operators in three pairs (algorithm 5). Each pair is a modulator bending a carrier; Ratio sets the modulator\'s speed, Level how much it bends. Pair 1 is the metallic tine, pair 2 the body, pair 3 (slightly detuned) the width. It has its own envelopes, so it only needs Pitch and Gate. Unlike the rest of the rack you cannot see inside it: build the DX7 E-Piano guide first to understand what it does.',
      tryThis: 'Patch Keyboard Pitch, Gate and Vel into the DX and its Out into a Chorus. Play soft and hard: the tine reacts to how hard you play.'
    },
    controls: [
      { id: 'r1', label: 'Ratio 1', min: 0.5, max: 16, def: 14, step: 0.5, unit: '×', info: 'Speed of the first modulator compared to its carrier. 14 gives the metallic tine of E.PIANO 1.' },
      { id: 'l1', label: 'Level 1', min: 0, max: 1, def: 0.35, info: 'How strongly pair 1 bends its carrier: the brightness of the tine.' },
      { id: 'r2', label: 'Ratio 2', min: 0.5, max: 16, def: 1, step: 0.5, unit: '×', info: 'Speed of the second modulator. 1 gives warm, even overtones.' },
      { id: 'l2', label: 'Level 2', min: 0, max: 1, def: 0.5, info: 'How strongly pair 2 bends its carrier: the warmth of the body.' },
      { id: 'r3', label: 'Ratio 3', min: 0.5, max: 16, def: 1, step: 0.5, unit: '×', info: 'Speed of the third modulator.' },
      { id: 'l3', label: 'Level 3', min: 0, max: 1, def: 0.3, info: 'How strongly pair 3 bends its carrier.' },
      { id: 'det', label: 'Detune', min: 0, max: 20, def: 7, unit: 'ct', info: 'How far the third carrier is detuned, in cents: beating and width, like the ±7 of the original preset.' },
      { id: 'dec', label: 'Bright Dec', full: 'Brightness Decay', min: 0.05, max: 5, def: 1.2, curve: 'exp', unit: 's', info: 'How fast the modulation fades after each note: the tine fades fastest, the body slowest.' },
      { id: 'adec', label: 'Decay', min: 0.2, max: 10, def: 3, curve: 'exp', unit: 's', info: 'How long a held note takes to die away.' },
      { id: 'rel', label: 'Release', min: 0.02, max: 4, def: 0.4, curve: 'exp', unit: 's', info: 'How long a note rings after you let go.' }
    ],
    inputs: [
      { id: 'pitch', label: 'Pitch', kind: 'signal', info: 'The note, from a Keyboard or Sequencer.' },
      { id: 'gate', label: 'Gate', kind: 'gate', info: 'Starts and releases the note (and its built-in envelopes).' },
      { id: 'vel', label: 'Vel', kind: 'signal', info: 'Velocity from the Keyboard: harder notes are louder and brighter.' }
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'signal', sig: 'audio', info: 'The FM voice.' }],
    create(ctx, p) {
      const pitchIn = ctx.createGain(), velIn = ctx.createGain(), out = ctx.createGain();
      if (!ctx.__mssWorklet) return { inputs: { pitch: pitchIn, gate() {}, vel: velIn }, outputs: { out }, set() {}, destroy() {} }; // needs the worklet
      const node = new AudioWorkletNode(ctx, 'mss-fm6', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
      pitchIn.connect(node, 0, 0); velIn.connect(node, 0, 1); node.connect(out);
      const apply = () => { for (const k of ['r1', 'r2', 'r3', 'l1', 'l2', 'l3', 'dec', 'adec', 'rel', 'det']) node.parameters.get(k).setValueAtTime(p[k], ctx.currentTime); };
      apply();
      return { inputs: { pitch: pitchIn, gate: (on, t) => node.port.postMessage({ on, t }), vel: velIn }, outputs: { out }, set: apply,
        destroy() { disconnectAll(pitchIn, velIn, node, out); } };
    }
  },

  scope: {
    name: 'Scope', hp: 14, accent: '#8ff0c0', display: 'scope',
    info: {
      title: 'Scope · Oscilloscope',
      text: 'An oscilloscope draws a signal so you can see it. Left to right is time, up and down is the value of the signal at that moment. Sound shows up as a fast, repeating wave; control signals like an envelope or LFO show up as slow shapes. The Scope makes no sound and changes nothing: patch any output into A or B to look at it (that output keeps all its other cables). Both traces share one scale and have the colour of their cable (B a lighter shade), so you can compare them, for example the sound before and after a filter.',
      tryThis: 'Patch a VCO into A and the VCF after it into B, hold a note and turn the VCF Cutoff down: watch the sharp corners of the wave get rounded off.'
    },
    controls: [
      { id: 'time', label: 'Time', type: 'select', options: [0.005, 0.02, 0.1, 1, 4], labels: ['5 ms', '20 ms', '100 ms', '1 s', '4 s'], def: 0.02, info: 'How much time the screen shows from left to right. 5 ms and 20 ms show single vibrations of a sound (ms = milliseconds). 100 ms shows a few. 1 s and 4 s roll slowly from right to left, for envelopes and LFOs.' },
      { id: 'scale', label: 'Scale', type: 'select', options: ['auto', 0.2, 1, 2], labels: ['Auto', '±0.2', '±1', '±2'], def: 'auto', info: 'How tall the screen is: the value at the top edge (and minus that at the bottom). Auto picks a scale that fits the bigger of the two signals. A fixed scale lets you see whether something got louder or quieter.' },
      { id: 'freeze', label: 'Freeze', type: 'toggle', def: 0, transient: true, info: 'Stops the picture, so you can look at it in peace. Tap again to continue.' }
    ],
    inputs: [
      { id: 'a', label: 'A', kind: 'signal', info: 'First signal to look at. Its trace has the colour of its cable. With Time at 5, 20 or 100 ms the Scope also shows its frequency in Hz (vibrations per second) and the nearest note.' },
      { id: 'b', label: 'B', kind: 'signal', info: 'Second signal, drawn on the same scale as A, to compare the two.' }
    ],
    outputs: [],
    create(ctx) {
      // each input feeds an analyser that the panel display reads (see drawScope in app.js)
      const chans = [0, 1].map(() => {
        const g = ctx.createGain(), an = ctx.createAnalyser(); an.fftSize = 32768; g.connect(an);
        return { g, an, buf: new Float32Array(an.fftSize), roll: [] };
      });
      return {
        inputs: { a: chans[0].g, b: chans[1].g }, outputs: {}, scope: chans,
        set() {},
        destroy() { disconnectAll(...chans.map(c => c.g)); }
      };
    }
  },

  output: {
    name: 'Output', hp: 6, accent: '#e2574c', display: 'meter',
    info: {
      title: 'Output',
      text: 'The end of the chain: whatever reaches this module goes to the speaker. Nothing is heard unless a cable arrives here. The Rec button records exactly what you hear as a WAV file (uncompressed audio, opens in any music program).',
      tryThis: 'Patch a VCO straight into the Output to hear the raw oscillator, with no filter and no envelope. It never stops, because nothing closes it.'
    },
    controls: [
      { id: 'vol', label: 'Volume', min: 0, max: 1, def: 0.6, info: 'Master volume. The meter above shows the level: green is fine, yellow is loud, red means the limiter is working hard and the sound may squash.' },
      { id: 'pan', label: 'Pan', min: -1, max: 1, def: 0, info: 'Moves the sound to the left (−) or right (+) speaker. Stereo effects (Chorus, Reverb) keep their width.' },
      { id: 'rec', label: 'Rec', type: 'toggle', def: 0, transient: true, info: 'Starts and stops recording (up to 5 minutes). When you stop, you can save or share the WAV file.' }
    ],
    inputs: [{ id: 'in', label: 'In', kind: 'signal', info: 'The sound to play on the speaker.' }],
    outputs: [],
    create(ctx, p, hooks) {
      const inG = ctx.createGain();
      const vol = ctx.createGain(); vol.gain.value = p.vol;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (pan.pan) pan.pan.value = p.pan || 0;
      // treat mono as stereo (left = right), so the centre position passes the sound unchanged
      pan.channelCount = 2; pan.channelCountMode = 'explicit'; pan.channelInterpretation = 'speakers';
      inG.connect(vol).connect(pan).connect(engine.master);
      return {
        inputs: { in: inG }, outputs: { tap: vol },
        set(id, v) {
          if (id === 'vol') vol.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
          if (id === 'pan' && pan.pan) pan.pan.setTargetAtTime(v, ctx.currentTime, 0.01);
          if (id === 'rec' && hooks && hooks.rec) hooks.rec(!!v, vol);
        },
        destroy() { if (hooks && hooks.rec) hooks.rec(false, vol); disconnectAll(inG, vol, pan); }
      };
    }
  }
};

export const MODULE_ORDER = ['keyboard', 'sequencer', 'arp', 'clock', 'vco', 'noise', 'dx', 'vcf', 'fold', 'ring', 'vca', 'adsr', 'clap', 'lfo', 'sh', 'slew', 'quant', 'atten', 'mixer', 'trigger', 'delay', 'chorus', 'reverb', 'scope', 'output'];

// Values for a module loaded from a patch: controls that are newer than the patch get their
// `legacy` value (how the module sounded before the control existed), not the new default (ADR 0010).
export function patchParams(type, params = {}) {
  const p = defaultParams(type);
  for (const c of MODULES[type].controls) if (c.legacy !== undefined && !(c.id in params)) p[c.id] = c.legacy;
  return { ...p, ...params };
}

export function defaultParams(type) {
  const p = {};
  for (const c of MODULES[type].controls) p[c.id] = c.def;
  return p;
}
