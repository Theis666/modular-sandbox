// Every abbreviation the app uses, explained once, here.
// Info sheets and guide steps list the ones they contain automatically,
// so an abbreviation is never shown without its meaning.
// `node tools/scan-abbreviations.mjs` checks that nothing is missing.

export const ABBR = {
  VCO: 'Voltage-Controlled Oscillator: makes the tone; its pitch can be set by a cable',
  VCF: 'Voltage-Controlled Filter: shapes the tone colour; its cutoff can be moved by a cable',
  VCA: 'Voltage-Controlled Amplifier: a volume control that a cable can turn',
  LFO: 'Low-Frequency Oscillator: a wave too slow to hear, used to move other knobs',
  ADSR: 'Attack, Decay, Sustain, Release: the four stages of an envelope',
  CV: 'Control Voltage: a signal that controls a setting instead of being heard',
  FM: 'Frequency Modulation: one oscillator bending the pitch of another',
  LP: 'Low-Pass: a filter that lets the lows through and cuts the highs',
  HP: 'High-Pass: a filter that lets the highs through and cuts the lows',
  BP: 'Band-Pass: a filter that only lets a band around the cutoff through',
  Reso: 'Resonance: boost at the filter cutoff',
  Amt: 'Amount: how strongly an input acts',
  Hz: 'Hertz: cycles (vibrations) per second',
  kHz: 'kilohertz: 1000 Hertz',
  ms: 'milliseconds: thousandths of a second',
  BPM: 'Beats Per Minute: the tempo',
  WAV: 'Waveform Audio File: an uncompressed audio file that every audio program can open',
  DX7: 'Yamaha DX7: a digital FM synthesizer from 1983',
  ROM: 'Read-Only Memory: here, the built-in sound bank of the DX7',
  'R&B': 'Rhythm and Blues: a genre of popular music',
  LA: 'Los Angeles',
  NI: 'Native Instruments: a music software company',
  FM8: 'a software FM synthesizer by Native Instruments',
  LP24: 'a steeper low-pass filter: 24 dB per octave instead of 12',
  dB: 'decibel: a unit for loudness and filter steepness',
  'ARP 2600': 'ARP 2600: a semi-modular analog synthesizer from 1971 (ARP was the company)',
  'CS-80': 'Yamaha CS-80: a large polyphonic analog synthesizer from 1977',
  'SH-2': 'Roland SH-2: a small monophonic analog synthesizer from 1979',
  'MT-60': 'Casio MT-60: a small home keyboard from 1982',
  EMS: 'Electronic Music Studios: a British synthesizer maker',
  VCS3: 'EMS VCS3: a small British modular synthesizer from 1969, also called the Synthi',
  AKS: 'Synthi AKS: the EMS VCS3 built into a briefcase, with a touch keyboard and a sequencer (from 1972)',
  RMI: 'Rocky Mount Instruments: an American maker of electronic organs and keyboards',
  THX: 'a cinema sound company; the Deep Note is its logo sound',
  VCV: 'VCV Rack: free software that works like a modular synthesizer on a computer',
  MIDI: 'Musical Instrument Digital Interface: the standard way electronic instruments talk to each other',
  UK: 'United Kingdom',
  'Fathom CM': 'Fathom CM: a software synthesizer given away by Computer Music magazine',
  DX: 'the DX module: a six-operator FM voice, named after the Yamaha DX7',
  'TR-808': 'Roland TR-808: a drum machine from 1980 that makes its drums with small synth circuits',
  'TR-909': 'Roland TR-909: a drum machine from 1983, the sound of house and techno',
  PWM: 'Pulse Width Modulation: moving the width of a square wave, for a shimmering, chorused sound'
};

// Words in capitals that are not abbreviations.
export const NOT_ABBR = new Set(['ON', 'OFF', 'PIANO', 'IV', 'II', 'C3', 'C4', 'G3', 'A3', 'D4', 'E3', 'E4']); // IV, II: Roman numerals ("Oxygène IV", Chorus mode II); C3 etc.: note names, explained where they appear

const escAbbr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ABBR_KEYS = Object.keys(ABBR).sort((a, b) => b.length - a.length).map(k => k.replace(/[&]/g, '\\&'));
const ABBR_RE = new RegExp(`(^|[^A-Za-z0-9])(${ABBR_KEYS.join('|')})(?![A-Za-z0-9])`, 'g');

// Abbreviations found in the given texts, in order of first appearance.
export function abbrIn(...texts) {
  const seen = [];
  for (const t of texts) for (const m of String(t || '').matchAll(ABBR_RE)) if (!seen.includes(m[2])) seen.push(m[2]);
  return seen;
}

// HTML-escaped text with abbreviations marked (dotted underline, tap for meaning).
export function markAbbr(text) {
  const s = String(text || '');
  let out = '', last = 0;
  for (const m of s.matchAll(ABBR_RE)) {
    const start = m.index + m[1].length;
    out += escAbbr(s.slice(last, start)) + `<abbr class="ab" data-ab="${escAbbr(m[2])}" title="${escAbbr(ABBR[m[2]])}">${escAbbr(m[2])}</abbr>`;
    last = start + m[2].length;
  }
  return out + escAbbr(s.slice(last));
}

// A compact legend: "VCO = Voltage-Controlled Oscillator · …"
export function legendHtml(list, compact) {
  if (!list.length) return '';
  const short = s => compact ? s.split(':')[0] : s;
  return `<div class="abbr-legend${compact ? ' compact' : ''}">${list.map(a => `<span><b>${escAbbr(a)}</b> = ${escAbbr(short(ABBR[a]))}</span>`).join('')}</div>`;
}
