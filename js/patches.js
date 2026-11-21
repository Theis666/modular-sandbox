// Example Patches: each demonstrates one concept (see ADR 0001).
const P = (name, description, modules, cables) => ({
  format: 'modular-synth-sandbox', version: 1, name, description,
  modules: modules.map(([id, type, params]) => ({ id, type, params: params || {} })),
  cables: cables.map(([fm, fj, tm, tj, color]) => ({ from: { module: fm, jack: fj }, to: { module: tm, jack: tj }, color }))
});

const basicModules = [
  ['kb', 'keyboard'], ['vco', 'vco'], ['vcf', 'vcf'], ['env', 'adsr'], ['vca', 'vca'], ['out', 'output']
];
const basicCables = [
  ['kb', 'pitch', 'vco', 'pitch', 0], ['kb', 'gate', 'env', 'gate', 1],
  ['vco', 'out', 'vcf', 'in', 2], ['vcf', 'out', 'vca', 'in', 3],
  ['env', 'out', 'vca', 'cv', 4], ['vca', 'out', 'out', 'in', 5]
];

export const EXAMPLES = [
  P('Basic Synth', 'The classic chain: Keyboard → VCO → VCF → VCA → Output, with an ADSR opening the VCA on every key press.',
    basicModules, basicCables),
  P('Vibrato', 'An LFO gently wobbles the VCO\'s pitch through its FM input.',
    [...basicModules, ['lfo', 'lfo', { rate: 5.5, depth: 0.04 }]],
    [...basicCables, ['lfo', 'out', 'vco', 'fm', 6]]),
  P('Wah', 'An LFO sweeps the filter cutoff up and down. High resonance makes the sweep easy to hear.',
    [['kb', 'keyboard'], ['vco', 'vco'], ['vcf', 'vcf', { cutoff: 500, res: 0.7, cv: 0.8 }], ['lfo', 'lfo', { rate: 1.5, depth: 0.8, wave: 'triangle' }],
     ['env', 'adsr', { s: 0.9 }], ['vca', 'vca'], ['out', 'output']],
    [...basicCables, ['lfo', 'out', 'vcf', 'cutoff', 6]]),
  P('Wind', 'No keyboard at all: Noise through a resonant band-pass filter, slowly moved by an LFO. The VCA is opened by hand with its Level knob.',
    [['noise', 'noise', { level: 1 }], ['vcf', 'vcf', { type: 'bandpass', cutoff: 700, res: 0.3, cv: 0.5 }],
     ['lfo', 'lfo', { rate: 0.12, depth: 0.9 }], ['vca', 'vca', { level: 1 }], ['out', 'output', { vol: 1 }]],
    [['noise', 'out', 'vcf', 'in', 2], ['lfo', 'out', 'vcf', 'cutoff', 6], ['vcf', 'out', 'vca', 'in', 3], ['vca', 'out', 'out', 'in', 5]]),
  P('Sequenced Bass', 'The Sequencer plays the notes. One ADSR shapes both the loudness (VCA) and the brightness (VCF) of every step.',
    [['seq', 'sequencer', { run: 1, tempo: 112, len: 0.35 }], ['vco', 'vco', { tune: -1 }],
     ['vcf', 'vcf', { cutoff: 220, res: 0.55, cv: 0.9 }], ['env', 'adsr', { a: 0.003, d: 0.22, s: 0.15, r: 0.12 }],
     ['vca', 'vca'], ['out', 'output']],
    [['seq', 'pitch', 'vco', 'pitch', 0], ['seq', 'gate', 'env', 'gate', 1], ['vco', 'out', 'vcf', 'in', 2],
     ['vcf', 'out', 'vca', 'in', 3], ['env', 'out', 'vca', 'cv', 4], ['env', 'out', 'vcf', 'cutoff', 7], ['vca', 'out', 'out', 'in', 5]]),
  // Drums (guide 'drumbeat'): one Clock, two Sequencers for kick and snare, the hi-hat on every Clock pulse
  P('Drum Kit', 'A small drum machine. One Clock keeps time, two Sequencers play the kick and snare patterns, and the hi-hat plays on every Clock pulse. Every drum is a VCO or Noise, an ADSR with zero Sustain, and a VCA.',
    [['clk', 'clock', { tempo: 110 }],
     ['kseq', 'sequencer', { run: 1, g1: 1, g2: 0, g3: 0, g4: 0, g5: 1, g6: 0, g7: 0, g8: 0 }],
     ['sseq', 'sequencer', { run: 1, g1: 0, g2: 0, g3: 1, g4: 0, g5: 0, g6: 0, g7: 1, g8: 0 }],
     ['kvco', 'vco', { wave: 'sine', tune: -1, fm: 1 }], ['kpenv', 'adsr', { a: 0.001, d: 0.06, s: 0, r: 0.05 }],
     ['kenv', 'adsr', { a: 0.001, d: 0.45, s: 0, r: 0.3 }], ['kvca', 'vca'],
     ['svco', 'vco', { wave: 'triangle', fm: 0.5 }], ['snoise', 'noise', { level: 0.8 }],
     ['sf', 'vcf', { type: 'highpass', cutoff: 1800, res: 0.1 }], ['smix', 'mixer', { l1: 0.6, l2: 0.9, l3: 0 }],
     ['senv', 'adsr', { a: 0.001, d: 0.18, s: 0, r: 0.15 }], ['svca', 'vca'],
     ['hnoise', 'noise', { level: 0.8 }], ['hf', 'vcf', { type: 'highpass', cutoff: 8000, res: 0.2 }],
     ['henv', 'adsr', { a: 0.001, d: 0.05, s: 0, r: 0.05 }], ['hvca', 'vca'],
     ['mix', 'mixer', { l1: 0.9, l2: 0.6, l3: 0.35 }], ['out', 'output']],
    [['clk', 'clock', 'kseq', 'clock', 1], ['clk', 'clock', 'sseq', 'clock', 1], ['clk', 'clock', 'henv', 'gate', 1],
     ['kseq', 'gate', 'kpenv', 'gate', 1], ['kseq', 'gate', 'kenv', 'gate', 1],
     ['kpenv', 'out', 'kvco', 'pitch', 4], ['kpenv', 'out', 'kvco', 'fm', 4], ['kvco', 'out', 'kvca', 'in', 2],
     ['kenv', 'out', 'kvca', 'cv', 4], ['kvca', 'out', 'mix', 'in1', 5],
     ['sseq', 'gate', 'senv', 'gate', 1], ['senv', 'out', 'svco', 'fm', 4], ['svco', 'out', 'smix', 'in1', 2],
     ['snoise', 'out', 'sf', 'in', 2], ['sf', 'out', 'smix', 'in2', 3], ['smix', 'out', 'svca', 'in', 3],
     ['senv', 'out', 'svca', 'cv', 4], ['svca', 'out', 'mix', 'in2', 5],
     ['hnoise', 'out', 'hf', 'in', 2], ['hf', 'out', 'hvca', 'in', 3], ['henv', 'out', 'hvca', 'cv', 4], ['hvca', 'out', 'mix', 'in3', 5],
     ['mix', 'out', 'out', 'in', 5]])
];
