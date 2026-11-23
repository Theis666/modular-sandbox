import { engine, startAudio } from './engine.js';
import { MODULES, MODULE_ORDER, defaultParams, patchParams } from './modules.js';
import { EXAMPLES } from './patches.js';
import { Recorder, MAX_SECONDS } from './recorder.js';
import { initGuide } from './guide.js';
import { initIntro } from './intro.js';
import { initVoices } from './voices.js';
import { initEar } from './ear.js';
import { renderPatch } from './offline.js';
import { LIBRARY } from './library.js';
import { ABBR, abbrIn, markAbbr, legendHtml } from './abbr.js';

const $ = (s, el = document) => el.querySelector(s);
// running inside another page (e.g. the Artifact viewer): that page owns the safe areas (see styles.css, html.framed)
try { if (window.self !== window.top) document.documentElement.classList.add('framed'); } catch (e) { document.documentElement.classList.add('framed'); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Cable colour = what the cable carries. Neighbouring cables of the same kind get slightly
// different shades so they can still be told apart.
const SIGNAL_TYPES = {
  audio: { name: 'Audio', hue: 2, sat: 78, light: 58, what: 'sound you can hear' },
  cv: { name: 'CV', hue: 212, sat: 78, light: 60, what: 'a control signal that moves a setting' },
  pitch: { name: 'Pitch', hue: 140, sat: 52, light: 50, what: 'which note to play' },
  gate: { name: 'Gate', hue: 44, sat: 88, light: 60, what: 'key held down: on or off' }
};
const signalColor = (sig, shade = 0) => { const t = SIGNAL_TYPES[sig] || SIGNAL_TYPES.audio; return `hsl(${t.hue} ${t.sat}% ${t.light + [0, -9, 8][shade % 3]}%)`; };
const cableLegendHtml = () => `<div class="cable-legend">${Object.entries(SIGNAL_TYPES).map(([k, t]) => `<span><i style="background:${signalColor(k)}"></i><b>${t.name}</b> ${t.what}</span>`).join('')}</div>`;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const RACK_HP = 28;

const S = {
  modules: [], cables: [], scale: 1, hp: 14, infoMode: false, cableMode: 0,
  pending: null, octave: 3, nextId: 1, recorder: null, loading: false
};

const rackWrap = $('#rackWrap'), sizer = $('#rackSizer'), rack = $('#rack'), svg = $('#cables');

// ---------- storage ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
let saveTimer = null;
// Every change is saved shortly after it happens; the same moment records an undo step.
// A knob drag therefore becomes one undo step, not hundreds.
const history = { stack: [], max: 60 };
function autosave() {
  if (S.loading) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const p = serialize();
    store.set('mss.current', p);
    const snap = JSON.stringify(p);
    if (history.stack[history.stack.length - 1] !== snap) {
      history.stack.push(snap);
      if (history.stack.length > history.max) history.stack.shift();
    }
    updateUndo();
  }, 300);
}
function updateUndo() {
  const b = document.getElementById('undoBtn'); if (b) b.disabled = history.stack.length < 2;
}
function undo() {
  clearTimeout(saveTimer);
  // an edit still waiting for its save counts as the current state
  const pendingSnap = JSON.stringify(serialize());
  if (history.stack[history.stack.length - 1] !== pendingSnap) history.stack.push(pendingSnap);
  if (history.stack.length < 2) { toast('Nothing to undo', 1500); return; }
  history.stack.pop();
  const prev = history.stack[history.stack.length - 1];
  const top = rackWrap.scrollTop;
  loadPatch(JSON.parse(prev), { keepScroll: true });
  rackWrap.scrollTop = top;
  toast(`Undone${history.stack.length > 1 ? '' : ' (nothing more to undo)'}`, 1200);
  updateUndo();
}

// ---------- value mapping ----------
function toNorm(c, v) {
  if (c.curve === 'exp') return c.min > 0 ? Math.log(v / c.min) / Math.log(c.max / c.min) : Math.cbrt((v - c.min) / (c.max - c.min));
  return (v - c.min) / (c.max - c.min);
}
function fromNorm(c, n) {
  n = clamp(n, 0, 1);
  let v = c.curve === 'exp' ? (c.min > 0 ? c.min * Math.pow(c.max / c.min, n) : c.min + (c.max - c.min) * n ** 3) : c.min + (c.max - c.min) * n;
  if (c.step) v = Math.round(v / c.step) * c.step;
  return clamp(v, c.min, c.max);
}
function fmt(c, v) {
  switch (c.unit) {
    case 'Hz': return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' kHz' : (v < 10 ? v.toFixed(2) : Math.round(v)) + ' Hz';
    case 's': return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
    case 'st': return NOTE_NAMES[v % 12] + (3 + Math.floor(v / 12));
    case 'oct': return (v > 0 ? '+' : '') + v + ' oct';
    case 'ct': return (v > 0 ? '+' : '') + Math.round(v) + ' ct';
    case 'bpm': return Math.round(v) + ' BPM';
    case 'n': return String(Math.round(v));
    case '×': return (Math.round(v * 2) / 2) + '×';
    default: return (c.min < 0 && v > 0 ? '+' : '') + v.toFixed(2);
  }
}

// ---------- waveform drawings ----------
// One period-ish of each shape, drawn into a 32×16 box.
const WAVE_PATHS = {
  sine: (() => { let d = ''; for (let i = 0; i <= 28; i++) { const x = 2 + i, y = 8 - 5.5 * Math.sin(i / 28 * Math.PI * 2); d += (i ? 'L' : 'M') + x + ' ' + y.toFixed(2); } return d; })(),
  triangle: 'M2 8 L8.5 2.5 L21.5 13.5 L30 6',
  sawtooth: 'M2 13.5 L15 2.5 L15 13.5 L28 2.5 L28 13.5',
  random: 'M2 9 C5 3, 7 4, 9 7 S 13 14, 16 11 S 20 3, 23 5 S 28 12, 30 9',
  sh: 'M2 10 L7 10 L7 4 L12 4 L12 12 L17 12 L17 6 L22 6 L22 13 L27 13 L27 8 L30 8',
  square: 'M2 13.5 L2 2.5 L9 2.5 L9 13.5 L16 13.5 L16 2.5 L23 2.5 L23 13.5 L30 13.5'
};
const waveSvg = w => `<svg class="wave" viewBox="0 0 32 16" aria-hidden="true"><path d="${WAVE_PATHS[w]}"/></svg>`;
function selFace(c, v) {
  const label = c.labels[c.options.indexOf(v)];
  return c.icons && WAVE_PATHS[v] ? waveSvg(v) : esc(label);
}

// ---------- modules ----------
const modById = id => S.modules.find(m => m.id === id);
const voices = initVoices({ S, MODULES, engine, modById });
const afterParam = (m, id, v) => { if (id === 'last' && m.el.querySelector('.banks')) showBank(m); voices.set(m, id, v); if (m.type === 'keyboard' && id === 'voices') voices.rebuild(); cpuCheck(); };

function addModule(type, params, id, opts = {}) {
  const def = MODULES[type]; if (!def) return null;
  const m = { id: id || 'm' + S.nextId++, type, params: opts.fromPatch ? patchParams(type, params || {}) : { ...defaultParams(type), ...(params || {}) } };
  if (def.controls.some(c => c.transient)) def.controls.filter(c => c.transient).forEach(c => m.params[c.id] = c.def);
  m.ui = { ...((opts && opts.ui) || {}) };
  m.el = renderModule(m);
  onScreen.observe(m.el);
  m.el.classList.toggle('expanded', !!m.ui.expanded);
  m.inst = def.create(engine.ctx, m.params, makeHooks(m));
  const before = opts.before ? modById(opts.before) : null;
  if (before) { S.modules.splice(S.modules.indexOf(before), 0, m); rack.insertBefore(m.el, before.el); }
  else { S.modules.push(m); rack.appendChild(m.el); }
  if (!S.loading) { refreshNames(); layout(); autosave(); }
  return m;
}

function makeHooks(m) {
  return {
    step(s) {
      m.el.querySelectorAll('.step-led').forEach((l, i) => l.classList.toggle('on', i === s));
      m.el.querySelectorAll('.banks button').forEach(x => x.classList.toggle('playing', s >= 0 && +x.dataset.bank === s >> 3));
    },
    rec(on, node) { on ? startRecording(m, node) : stopRecording(m); }
  };
}

// M0-3 CPU guard: a polyphonic patch is rendered for half a second in the background.
// The time that takes, compared with real time, estimates the audio load on this device.
let cpuTimer = null;
function cpuCheck() {
  clearTimeout(cpuTimer);
  const kb = S.modules.find(m => m.type === 'keyboard' && m.params.voices > 1);
  if (!kb || !engine.ctx || typeof OfflineAudioContext === 'undefined') return;
  cpuTimer = setTimeout(async () => {
    const n = Math.round(kb.params.voices), notes = [48, 52, 55, 59, 62, 65, 69, 72].slice(0, n);
    let ms;
    try { ({ ms } = await renderPatch(serialize(), { seconds: 0.5, notes, hold: 1, timed: false })); } catch (e) { return; }
    const load = S.cpuLoad = ms / 500;
    if (!S.modules.includes(kb) || Math.round(kb.params.voices) !== n) return; // changed meanwhile
    if (load > 0.85 && n > 2) {
      const nv = Math.max(2, Math.floor(n / 2));
      setParam(kb, 'voices', nv);
      toast(`This patch is too heavy for this device with ${n} voices (about ${Math.round(load * 100)}% of its audio power). Voices lowered to ${nv}.`, 5000);
    } else if (load > 0.5) toast(`Heavy patch: ${n} voices use about ${Math.round(load * 100)}% of this device's audio power. If the sound crackles, lower the Keyboard's Voices.`, 4500);
  }, 1500);
}

// ADR 0010: two pages of controls. The MAIN / MORE tabs under the module name switch between them.
function setExpanded(m, on) {
  m.ui.expanded = !!on;
  m.el.classList.toggle('expanded', m.ui.expanded);
  m.el.querySelectorAll('.pages button').forEach(b => { const sel = +b.dataset.page === (on ? 1 : 0); b.classList.toggle('on', sel); b.setAttribute('aria-selected', sel); });
  // the first few times, say what the More page is
  const seen = store.get('mss.morePage') || 0;
  if (on && seen < 3 && !document.body.classList.contains('guiding')) {
    store.set('mss.morePage', seen + 1);
    toast(`${m.name} · More: extra controls for fine-tuning (${MODULES[m.type].controls.filter(c => c.expert && !c.mini).map(c => c.label).join(', ')}). Tap Main to go back.`, 3500);
  }
  autosave();
}

function removeModule(m) {
  S.cables.filter(c => c.from.module === m.id || c.to.module === m.id).forEach(c => removeCable(c, true));
  for (const k of [...analysers.keys()]) if (k.startsWith(m.id + ':')) analysers.delete(k);
  m.inst.destroy(); onScreen.unobserve(m.el); m.el.remove();
  S.modules.splice(S.modules.indexOf(m), 1);
  voices.rebuild(); cpuCheck();
  refreshNames(); layout(); autosave();
}

function moveModule(m, dir) {
  const i = S.modules.indexOf(m), j = i + dir;
  if (j < 0 || j >= S.modules.length) return;
  moveModuleTo(m, j);
}
function moveModuleTo(m, j) {
  const i = S.modules.indexOf(m);
  if (i === j) return;
  S.modules.splice(i, 1); S.modules.splice(j, 0, m);
  S.modules.forEach(x => rack.appendChild(x.el));
  rack.appendChild(svg);
  layout(); autosave();
}

// Drag a module by its name bar to move it; drop it on the bin at the top to remove it.
const dropMark = document.createElement('div'); dropMark.id = 'dropMark'; dropMark.hidden = true; rack.appendChild(dropMark);
const bin = document.createElement('div'); bin.id = 'bin'; bin.hidden = true;
bin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg><span>Drop here to remove</span>';
document.body.appendChild(bin);
function onHeadDown(e, m) {
  const head = e.target.closest('.mhead'), x0 = e.clientX, y0 = e.clientY;
  let drag = null;
  try { head.setPointerCapture(e.pointerId); } catch (err) {}
  const move = ev => {
    if (!drag) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
      drag = { m, slot: null, overBin: false, sl: rackWrap.scrollLeft, st: rackWrap.scrollTop };
      m.el.classList.add('dragging'); document.body.classList.add('moving'); bin.hidden = false;
      clearPending(); hideBubble();
    }
    const wr = rackWrap.getBoundingClientRect();
    if (ev.clientY > wr.bottom - 40) rackWrap.scrollTop += 8; else if (ev.clientY < wr.top + 40) rackWrap.scrollTop -= 8;
    if (ev.clientX > wr.right - 40) rackWrap.scrollLeft += 8; else if (ev.clientX < wr.left + 40) rackWrap.scrollLeft -= 8;
    // the module follows the finger (measured from where it sits in the rack, so scrolling is included)
    const dx = ev.clientX - x0 + rackWrap.scrollLeft - drag.sl, dy = ev.clientY - y0 + rackWrap.scrollTop - drag.st;
    m.el.style.transform = `translate(${dx / S.scale}px, ${dy / S.scale}px)`;
    const br = bin.getBoundingClientRect();
    drag.overBin = ev.clientY < br.bottom + 6;
    bin.classList.toggle('hot', drag.overBin);
    drag.slot = drag.overBin ? null : dropSlot(m, ev.clientX, ev.clientY);
    showDropMark(drag.slot);
    drawCables(true);
  };
  const end = ev => {
    head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', end); head.removeEventListener('pointercancel', end);
    // a tap without movement opens the menu (on pointerup: the touch may have no click, see the touchstart guard)
    // while a jack is picked, the tap only drops it (rackWrap pointerup below), no menu
    if (!drag) { if (ev.type === 'pointerup' && !(S.pending && S.pending.mode === 'tap')) moduleMenu(m); return; }
    m.el.classList.remove('dragging'); m.el.style.transform = '';
    document.body.classList.remove('moving'); bin.hidden = true; bin.classList.remove('hot'); dropMark.hidden = true;
    if (ev.type !== 'pointerup') { drawCables(); return; }
    if (drag.overBin) { const name = m.name; removeModule(m); toast(`${name} removed. ↶ brings it back.`, 2500); return; }
    if (drag.slot) moveModuleTo(m, drag.slot.index); else drawCables();
  };
  head.addEventListener('pointermove', move); head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
}
// the gap between two modules nearest to the finger; index = the module's new place in the rack
function dropSlot(m, x, y) {
  const others = S.modules.filter(o => o !== m);
  let best = null, bd = Infinity;
  others.forEach((o, k) => {
    const r = o.el.getBoundingClientRect();
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    for (const [side, ex] of [[0, r.left], [1, r.right]]) {
      const d = Math.abs(ex - x) + dy * 3; // rows count more than columns
      if (d < bd) { bd = d; best = { index: k + side, x: ex, top: r.top, bottom: r.bottom }; }
    }
  });
  return best;
}
function showDropMark(slot) {
  if (!slot) { dropMark.hidden = true; return; }
  const a = localPoint(slot.x, slot.top), b = localPoint(slot.x, slot.bottom);
  dropMark.hidden = false;
  Object.assign(dropMark.style, { left: a.x - 3 + 'px', top: a.y + 'px', height: b.y - a.y + 'px' });
}

function refreshNames() {
  const count = {}, idx = {};
  S.modules.forEach(m => count[m.type] = (count[m.type] || 0) + 1);
  S.modules.forEach(m => {
    idx[m.type] = (idx[m.type] || 0) + 1;
    m.name = MODULES[m.type].name + (count[m.type] > 1 ? ' ' + idx[m.type] : '');
    $('.mname', m.el).textContent = m.name;
  });
}

function renderModule(m) {
  const def = MODULES[m.type];
  const el = document.createElement('div');
  el.className = 'module m-' + m.type; el.dataset.mod = m.id;
  el.style.setProperty('--w', def.hp);
  el.style.setProperty('--accent', def.accent);
  const ctl = c => {
    const approx = provOf(m.id, c.id) === 'inferred' ? '<span class="approx" title="Starting value, not from the source">≈</span>' : '';
    if (c.type === 'select') return `<div class="ctl" data-ctl="${c.id}"><button class="sel${c.icons ? ' icon' : ''}" aria-label="${c.label}: ${c.labels[c.options.indexOf(m.params[c.id])]}">${selFace(c, m.params[c.id])}</button><label>${approx}${c.label}</label></div>`;
    if (c.type === 'toggle') return `<div class="ctl${c.mini ? ' mini' : ''}" data-ctl="${c.id}"${c.bank !== undefined ? ` data-bank="${c.bank}"` : ''}><button class="tog${m.params[c.id] ? ' on' : ''}" aria-label="${c.full || c.label}"><i></i>${c.label}</button></div>`;
    return `<div class="ctl${c.small ? ' small' : ''}" data-ctl="${c.id}"><div class="knob"><div class="ind"></div></div><label>${approx}${c.label}</label></div>`;
  };
  const jack = (j, dir) => `<div class="jack-wrap ${dir} k-${j.kind}" data-jack="${j.id}" data-dir="${dir}" data-kind="${j.kind}"><div class="jack"></div><label>${j.label}</label></div>`;
  const steps = def.controls.filter(c => c.small && !c.stepGate), rest = def.controls.filter(c => !c.small);
  const expert = rest.filter(c => c.expert); // ADR 0010: shown instead of the main controls when the module is expanded (MORE tab)
  const gateOf = i => def.controls.find(c => c.stepGate === i + 1);
  // a step: its on/off button (with the running light inside) above its note knob
  const stepCol = (c, i) => { const g = gateOf(i); return `<div class="stepcol"${c.bank !== undefined ? ` data-bank="${c.bank}"` : ''}>${g ? `<div class="ctl stepgate" data-ctl="${g.id}"><button class="tog step${m.params[g.id] ? ' on' : ''}" aria-label="Step ${i + 1} on or off"><i class="step-led"></i></button></div>` : '<i class="step-led"></i>'}${ctl(c)}</div>`; };
  el.innerHTML = `
    <i class="screw tl"></i><i class="screw tr"></i><i class="screw bl"></i><i class="screw br"></i>
    <div class="mhead"><button class="mname" aria-label="Module menu; drag to move"></button><button class="ibtn" aria-label="Module info">i</button></div>
    ${expert.length ? `<div class="pages" role="tablist" aria-label="Control pages"><button data-page="0" role="tab" class="${m.ui.expanded ? '' : 'on'}" aria-selected="${!m.ui.expanded}">Main</button><button data-page="1" role="tab" class="${m.ui.expanded ? 'on' : ''}" aria-selected="${!!m.ui.expanded}">More</button></div>` : '<div class="stripe"></div>'}
    ${steps.length > 8 ? `<div class="banks" role="tablist" aria-label="Which steps to show"><button data-bank="0" role="tab"><i></i>1–8</button><button data-bank="1" role="tab"><i></i>9–16</button></div>` : ''}
    ${def.led ? '<div class="led" data-led="' + def.led + '"></div>' : ''}
    ${def.display ? '<canvas class="disp" aria-hidden="true"></canvas>' : ''}
    ${steps.length ? `<div class="steps">${steps.map(stepCol).join('')}</div>` : ''}
    <div class="controls">${rest.filter(c => !c.expert).map(ctl).join('')}</div>
    ${expert.length ? `<div class="controls expert">${expert.map(ctl).join('')}</div>` : ''}
    <div class="jacks">
      ${def.inputs.length ? `<div class="ins">${def.inputs.map(j => jack(j, 'in')).join('')}</div>` : ''}
      ${def.outputs.length ? `<div class="outs">${def.outputs.map(j => jack(j, 'out')).join('')}</div>` : ''}
    </div>`;
  def.controls.forEach(c => updateCtl(m, c, el));
  if (steps.length > 8) showBank(m, el);
  return el;
}

// Sequencer with 16 steps: one bank of eight is shown at a time (both pages follow it).
// The tab of the bank that is playing has a small light; a bank the loop does not reach (Steps ≤ 8) is dimmed.
function showBank(m, el = m.el) {
  const b = m.ui.bank ? 1 : 0;
  el.classList.toggle('bank1', !!b);
  el.querySelectorAll('.banks button').forEach(x => { const on = +x.dataset.bank === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
  const unused = el.querySelector('.banks [data-bank="1"]'); if (unused) unused.classList.toggle('unused', (m.params.last || 8) <= 8);
}
function setBank(m, b) {
  m.ui.bank = b ? 1 : 0; showBank(m); autosave();
  // 9–16 only play when the loop is longer than 8: opening them on a loop of exactly 8 (the default) makes it 16,
  // so what you set there is heard. Shorter loops (odd lengths on purpose) are left alone, with a hint.
  if (!b || (m.params.last || 8) > 8 || document.body.classList.contains('guiding')) return;
  if ((m.params.last || 8) === 8) { setParam(m, 'last', 16); toast('Steps is now 16, so the loop plays steps 9–16 too. Change it on the More page.', 3500); }
  else toast(`Steps 9–16 only play when Steps (More page) is above 8. It is ${m.params.last} now.`, 3500);
}

function updateCtl(m, c, el = m.el) {
  const box = el.querySelector(`[data-ctl="${c.id}"]`); if (!box) return;
  const v = m.params[c.id];
  if (c.type === 'select') { const b = $('.sel', box); b.innerHTML = selFace(c, v); b.setAttribute('aria-label', `${c.label}: ${c.labels[c.options.indexOf(v)]}`); }
  else if (c.type === 'toggle') $('.tog', box).classList.toggle('on', !!v);
  else $('.ind', box).style.transform = `rotate(${-135 + 270 * clamp(toNorm(c, v), 0, 1)}deg)`;
}

// change a value for listening only (guide before/after): no undo step, no autosave
function previewParam(m, id, v) {
  const c = MODULES[m.type].controls.find(x => x.id === id);
  m.params[id] = v; updateCtl(m, c); m.inst.set(id, v); afterParam(m, id, v);
}
function fmtValue(m, id, v) {
  const c = MODULES[m.type].controls.find(x => x.id === id);
  return c.type === 'select' ? c.labels[c.options.indexOf(v)] : fmt(c, v);
}
// library patches record per knob whether the value is from the source or inferred
function provOf(modId, ctlId) { const p = S.meta && S.meta.params && S.meta.params[modId]; return p && p[ctlId] ? p[ctlId].prov : null; }
function provText(modId, ctlId) {
  const e = S.meta && S.meta.params && S.meta.params[modId] && S.meta.params[modId][ctlId]; if (!e) return '';
  const lead = e.prov === 'inferred'
    ? '≈ Starting value: the source does not give this number, so this is a sensible starting point. Try your own.'
    : 'This value comes from the source.';
  const raw = e.raw != null && !(e.note || '').includes(String(e.raw)) ? ` (Original plugin value: ${e.raw}.)` : ''; // skip if the note already says it
  return ` ${lead}${e.note ? ' ' + e.note : ''}${raw}`;
}
function setParam(m, id, v) {
  const c = MODULES[m.type].controls.find(x => x.id === id);
  m.params[id] = v; updateCtl(m, c); m.inst.set(id, v); afterParam(m, id, v); autosave();
  // a switch with presets (e.g. Chorus Mode) also sets the knobs it stands for
  if (c.presets && c.presets[v]) for (const [k, val] of Object.entries(c.presets[v])) setParam(m, k, val);
}

// ---------- cables ----------
const jackDef = (ref, dir) => {
  const m = modById(ref.module); if (!m) return null;
  return MODULES[m.type][dir === 'out' ? 'outputs' : 'inputs'].find(j => j.id === ref.jack);
};
const sameRef = (a, b) => a.module === b.module && a.jack === b.jack && a.dir === b.dir;
function compatible(a, b) {
  if (a.dir === b.dir || a.kind !== b.kind) return false;
  const [o, i] = a.dir === 'out' ? [a, b] : [b, a];
  return !S.cables.some(c => c.from.module === o.module && c.from.jack === o.jack && c.to.module === i.module && c.to.jack === i.jack);
}
function refFromEl(jw) {
  return { module: jw.closest('.module').dataset.mod, jack: jw.dataset.jack, dir: jw.dataset.dir, kind: jw.dataset.kind };
}

function connect(a, b) {
  const [o, i] = a.dir === 'out' ? [a, b] : [b, a];
  const od = jackDef(o, 'out'), id = jackDef(i, 'in');
  if (!od || !id || od.kind !== id.kind) return null;
  S.cables.filter(c => c.to.module === i.module && c.to.jack === i.jack).forEach(c => removeCable(c, true));
  const c = {
    id: 'c' + S.nextId++, kind: od.kind,
    from: { module: o.module, jack: o.jack }, to: { module: i.module, jack: i.jack }
  };
  const src = modById(c.from.module).inst.outputs[c.from.jack];
  const dst = modById(c.to.module).inst.inputs[c.to.jack];
  if (c.kind === 'gate') src.listeners.add(dst); else src.connect(dst);
  c.el = makeCableEl(c);
  S.cables.push(c);
  if (!S.loading) { voices.rebuild(); cpuCheck(); recolorCables(); drawCables(); autosave(); }
  return c;
}

// What an output carries. Processing modules (VCF, VCA, Mixer, effects) pass on
// whatever arrives at their input: a VCA fed by an LFO outputs CV, not audio.
function signalOf(modId, jack, depth = 0) {
  const m = modById(modId); if (!m) return 'audio';
  const j = MODULES[m.type].outputs.find(o => o.id === jack);
  if (!j) return 'audio';
  if (j.kind === 'gate') return 'gate';
  if (!j.sig || !j.sig.startsWith('follow:')) return j.sig || 'audio';
  if (depth > 12) return 'audio'; // feedback loop: stop looking
  for (const inp of j.sig.slice(7).split(',')) {
    const c = S.cables.find(x => x.to.module === modId && x.to.jack === inp);
    if (c) return signalOf(c.from.module, c.from.jack, depth + 1);
  }
  return 'audio';
}
function recolorCables() {
  const count = {};
  for (const c of S.cables) {
    c.sig = signalOf(c.from.module, c.from.jack);
    const n = count[c.sig] = (count[c.sig] || 0) + 1;
    c.el.style.setProperty('--c', signalColor(c.sig, n - 1));
  }
}

function removeCable(c, silent) {
  const sm = modById(c.from.module), dm = modById(c.to.module);
  const src = sm.inst.outputs[c.from.jack], dst = dm.inst.inputs[c.to.jack];
  if (c.kind === 'gate') { src.listeners.delete(dst); dst(false, engine.ctx.currentTime); }
  else { try { src.disconnect(dst); } catch (e) {} }
  c.el.remove();
  S.cables.splice(S.cables.indexOf(c), 1);
  if (!S.loading) { voices.rebuild(); cpuCheck(); recolorCables(); }
  if (!silent) autosave();
}

function makeCableEl(c) {
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g'); g.classList.add('cable'); g.dataset.cable = c.id;
  g.style.setProperty('--c', signalColor(c.sig || 'audio'));
  g.innerHTML = `<path class="shadow"/><path class="outline"/><path class="main"/><path class="core"/>
    <circle class="plug p1" r="7"/><circle class="plug p2" r="7"/><path class="hit"/>`;
  svg.appendChild(g);
  return g;
}

function localPoint(x, y) {
  const r = rack.getBoundingClientRect();
  return { x: (x - r.left) / S.scale, y: (y - r.top) / S.scale };
}
function jackCenter(ref, dir) {
  const m = modById(ref.module); if (!m) return null;
  const el = m.el.querySelector(`.jack-wrap[data-dir="${dir}"][data-jack="${ref.jack}"] .jack`);
  const r = el.getBoundingClientRect();
  return localPoint(r.left + r.width / 2, r.top + r.height / 2);
}
function cablePath(a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = 18 + d * 0.3;
  return `M${a.x},${a.y} C${a.x},${a.y + sag} ${b.x},${b.y + sag} ${b.x},${b.y}`;
}
// ---------- cable routing: keep cables off the displays ----------
// A cable first hangs the usual way. If that crosses a display (envelope, filter curve, scope …),
// other shapes are tried: a tighter or looser sag, or a detour through a point in the gaps between
// modules or rows. The shape with the fewest points on a display wins; among equals, the shortest.
const pt = (x, y) => ({ x, y });
const bez = (s, t) => { const u = 1 - t, [p0, c1, c2, p3] = s; return pt(u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x, u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y); };
const segsPath = segs => `M${segs[0][0].x},${segs[0][0].y}` + segs.map(([, c1, c2, p]) => ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p.x},${p.y}`).join('');
function hang(a, b, f = 0.3) { const sag = 18 + Math.hypot(b.x - a.x, b.y - a.y) * f; return [[a, pt(a.x, a.y + sag), pt(b.x, b.y + sag), b]]; }
function via(a, b, w, vertical) {
  const da = Math.hypot(w.x - a.x, w.y - a.y), db = Math.hypot(b.x - w.x, b.y - w.y);
  const ka = da * 0.4, kb = db * 0.4;
  const dir = vertical ? Math.sign(b.y - a.y) || 1 : Math.sign(b.x - a.x) || 1;
  const t1 = vertical ? pt(w.x, w.y - dir * ka) : pt(w.x - dir * ka, w.y), t2 = vertical ? pt(w.x, w.y + dir * kb) : pt(w.x + dir * kb, w.y);
  return [[a, pt(a.x, a.y + 14 + da * 0.2), t1, w], [w, t2, pt(b.x, b.y + 14 + db * 0.2), b]];
}
// cost: a point on a display or outside the rack counts a lot, a point on a knob a little, plus the length
const inside = (p, rs) => rs.some(r => p.x > r.l && p.x < r.r && p.y > r.t && p.y < r.b);
function routeCost(segs, geo) {
  let hard = 0, soft = 0, len = 0, prev = segs[0][0];
  for (const s of segs) for (let k = 1; k <= 28; k++) {
    const p = bez(s, k / 28); len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p;
    if (p.x < 2 || p.x > geo.w - 2 || inside(p, geo.rects)) hard++;
    else if (inside(p, geo.knobs)) soft++;
  }
  return { hard, cost: hard * 1000 + soft * 40 + len };
}
// where displays sit, and where the gaps between modules and rows are (rack coordinates)
function routeGeometry() {
  const box = el => { const r = el.getBoundingClientRect(), p = localPoint(r.left, r.top), q = localPoint(r.right, r.bottom); return { l: p.x, t: p.y, r: q.x, b: q.y }; };
  const grow = (r, g) => ({ l: r.l - g, t: r.t - g, r: r.r + g, b: r.b + g });
  const rects = [...rack.querySelectorAll('canvas.disp')].filter(c => c.offsetParent).map(box).map(r => grow(r, 2));
  const knobs = [...rack.querySelectorAll('.knob')].filter(k => k.offsetParent).map(box).map(r => grow(r, 1));
  const mods = S.modules.map(m => box(m.el));
  const edges = [...new Set(mods.flatMap(m => [Math.round(m.l), Math.round(m.r)]))];
  const rows = [...new Set(mods.map(m => Math.round(m.b)))];
  return { rects, knobs, edges, gaps: rows.map(y => y + 7), w: rack.offsetWidth };
}
function route(a, b, geo) {
  const plain = hang(a, b);
  if (!geo.rects.length) return plain;
  const first = routeCost(plain, geo);
  if (first.hard <= 1) return plain; // clear of every display (or only grazing one): keep the familiar shape
  let best = plain, bc = first.cost;
  const consider = segs => { const c = routeCost(segs, geo).cost; if (c < bc) { bc = c; best = segs; } };
  for (const f of [0.02, 0.12, 0.55, 0.85]) consider(hang(a, b, f));
  const x0 = Math.min(a.x, b.x) - 80, x1 = Math.max(a.x, b.x) + 80, y0 = Math.min(a.y, b.y) - 30, y1 = Math.max(a.y, b.y) + 60;
  const xs = geo.edges.filter(x => x >= x0 && x <= x1), ys = [...geo.gaps.filter(y => y >= y0 && y <= y1), a.y + 30, b.y + 30];
  for (const x of xs) for (const y of ys) { consider(via(a, b, pt(x, y), false)); consider(via(a, b, pt(x, y), true)); }
  for (const y of ys) consider(via(a, b, pt((a.x + b.x) / 2, y), false));
  return best;
}

// fast = true (while a module is dragged or the rack zooms): plain hanging cables at once,
// the routed shapes follow when the movement pauses
let routeTimer = null;
function drawCables(fast) {
  clearTimeout(routeTimer);
  if (fast === true) routeTimer = setTimeout(() => drawCables(), 160);
  // measure the rack without the cable layer itself, so the layer can also shrink (e.g. when the guide panel narrows the rack)
  svg.setAttribute('width', 0); svg.setAttribute('height', 0);
  svg.setAttribute('width', rack.scrollWidth); svg.setAttribute('height', rack.scrollHeight);
  const geo = fast === true ? { rects: [] } : routeGeometry();
  for (const c of S.cables) {
    const a = jackCenter(c.from, 'out'), b = jackCenter(c.to, 'in'); if (!a || !b) continue;
    const d = segsPath(route(a, b, geo));
    c.el.querySelectorAll('path').forEach(p => p.setAttribute('d', d));
    const [p1, p2] = c.el.querySelectorAll('.plug');
    p1.setAttribute('cx', a.x); p1.setAttribute('cy', a.y); p2.setAttribute('cx', b.x); p2.setAttribute('cy', b.y);
  }
}

// ---------- layout & zoom ----------
const landscapePhone = matchMedia('(orientation: landscape) and (max-height: 560px)');
function layout(fast) {
  const W = rackWrap.clientWidth, H = rackWrap.clientHeight;
  // portrait: 28 HP fill the width. Landscape phone: one row of modules (24 HP tall) fills the height.
  // (landscape: the row is 24 HP tall plus a few px of rack padding; 9 HP-px is the smallest that stays usable; knob labels also turn the knob)
  S.hp = landscapePhone.matches ? clamp((H - 8) / 24, 9, 18) : clamp((Math.min(W, 520) - 12) / RACK_HP, 11, 18);
  rack.style.setProperty('--hp', S.hp + 'px');
  const innerW = Math.max(RACK_HP * S.hp + 12, W / S.scale);
  rack.style.width = innerW + 'px';
  rack.style.transform = `scale(${S.scale})`;
  requestAnimationFrame(() => {
    sizer.style.width = innerW * S.scale + 'px';
    sizer.style.height = rack.scrollHeight * S.scale + 'px';
    drawCables(fast === true);
  });
}
function setScale(s) {
  S.scale = clamp(s, 0.4, 2);
  layout(true);
  $('#zoomBtn').textContent = Math.round(S.scale * 100) + '%';
}
let gestureStart = 1;
// Two fingers zoom the rack, but never while a key is held: a finger resting on the keys plus
// one on the rack is playing, not zooming. The page itself never zooms (iOS ignores user-scalable=no).
const keyHeld = () => held.size > 0 || keyTouches > 0;
rackWrap.addEventListener('gesturestart', e => { e.preventDefault(); gestureStart = S.scale; S.pinch = !keyHeld(); });
rackWrap.addEventListener('gesturechange', e => { e.preventDefault(); if (S.pinch && !keyHeld()) setScale(gestureStart * e.scale); });
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, e => e.preventDefault(), { passive: false });
rackWrap.addEventListener('gestureend', e => e.preventDefault());
rackWrap.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setScale(S.scale * (1 - e.deltaY * 0.01)); } }, { passive: false });
// two-finger pinch fallback for non-Safari touch browsers
const touches = new Map();
// Touches that start on a knob (or its label), a jack or a module's name bar never scroll the rack.
// CSS touch-action says the same, but inside some app viewers on the iPhone it is not always honoured;
// cancelling the touch start is. (Buttons are left alone: they need their click.)
rackWrap.addEventListener('touchstart', e => {
  if (e.touches.length !== 1 || S.infoMode || !(e.target instanceof Element)) return;
  const t = e.target;
  if (t.closest('.ibtn, .pages, .banks, .sel, .tog')) return;
  const p = e.touches[0];
  if (t.closest('.knob, .jack-wrap, .mhead') || (t.closest('.ctl') && t.closest('.ctl').querySelector(':scope > .knob'))
    || (!t.closest('button') && jackNear(p.clientX, p.clientY))) e.preventDefault();
}, { passive: false });
rackWrap.addEventListener('touchstart', e => { if (e.touches.length === 2 && !('ongesturestart' in window)) { const [a, b] = e.touches; touches.set('d', Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)); touches.set('s', S.scale); } }, { passive: true });
rackWrap.addEventListener('touchmove', e => { if (e.touches.length === 2 && touches.has('d') && !keyHeld()) { const [a, b] = e.touches; setScale(touches.get('s') * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / touches.get('d')); } }, { passive: true });
rackWrap.addEventListener('touchend', () => touches.clear());
window.addEventListener('resize', layout);
landscapePhone.addEventListener && landscapePhone.addEventListener('change', () => requestAnimationFrame(layout));

// ---------- interaction: rack ----------
// Generous touch targets: a finger that lands up to 14 px beside a jack's edge
// still gets the jack. Knobs get an invisible ring (CSS .knob::after).
const SNAP_PX = 14;
function jackNear(x, y) {
  let best = null, bd = SNAP_PX;
  const pend = S.pending && S.pending.mode === 'tap' ? S.pending.ref : null;
  rack.querySelectorAll('.jack-wrap').forEach(jw => {
    const r = $('.jack', jw).getBoundingClientRect();
    let d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y) - r.width / 2; // distance from the jack's edge
    if (pend && compatible(pend, refFromEl(jw))) d -= 6; // prefer a jack that would complete the cable
    if (d < bd) { bd = d; best = jw; }
  });
  return best;
}
function knobFor(t) { return t.closest('.knob'); } // its invisible ring (CSS ::after) makes the target ~45 px
rack.addEventListener('pointerdown', e => {
  const t = e.target;
  if (S.infoMode) {
    const info = infoFor(jackNear(e.clientX, e.clientY) && !t.closest('.ctl, button') ? jackNear(e.clientX, e.clientY) : t); if (info) { e.preventDefault(); showInfo(info); }
    return;
  }
  const jw = t.closest('.jack-wrap'); if (jw) return onJackDown(e, jw);
  // the knob, its invisible ring, or its label: all turn the knob (bigger target for fingers)
  const knob = knobFor(t) || (t.closest('.ctl') && t.closest('.ctl').querySelector(':scope > .knob')); if (knob) return onKnobDown(e, knob);
  if (t.closest('.mhead') && !t.closest('.ibtn')) { const m = modById(t.closest('.module').dataset.mod); if (m) return onHeadDown(e, m); }
  if (!t.closest('button')) { const near = jackNear(e.clientX, e.clientY); if (near) return onJackDown(e, near); }
});
// A short tap anywhere on the rack (not on or beside a jack) drops a jack picked by tapping.
// Pointer events, not click: iOS sends no click where the touch start was cancelled (knobs, names).
// A scroll or a knob turn does not drop it, so you can scroll to the target jack.
let dropTap = null;
rackWrap.addEventListener('pointerdown', e => {
  dropTap = S.pending && S.pending.mode === 'tap' ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
}, true);
rackWrap.addEventListener('pointerup', e => {
  const d = dropTap; dropTap = null;
  if (!d || d.done || !S.pending || S.pending.mode !== 'tap' || S.infoMode) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 600) return;
  if (e.target.closest && e.target.closest('.jack-wrap') || jackNear(e.clientX, e.clientY)) return;
  clearPending(); toast(''); dropTap = { done: performance.now() };
});
rackWrap.addEventListener('pointercancel', () => { dropTap = null; });
rack.addEventListener('click', e => {
  const t = e.target;
  if (S.infoMode) return;
  // the click that follows a tap which dropped a picked jack does nothing else (no switch flips)
  if (dropTap && dropTap.done) { const late = performance.now() - dropTap.done > 400; dropTap = null; if (!late) return; }
  const m = t.closest('.module') && modById(t.closest('.module').dataset.mod);
  if (!m) return;
  const box = t.closest('.ctl'); const c = box && MODULES[m.type].controls.find(x => x.id === box.dataset.ctl);
  if (t.closest('.sel')) {
    const i = c.options.indexOf(m.params[c.id]), nv = c.options[(i + 1) % c.options.length];
    setParam(m, c.id, nv);
    if (c.icons) { const b = t.closest('.sel'); bubble(b, c.labels[c.options.indexOf(nv)]); clearTimeout(b._hb); b._hb = setTimeout(hideBubble, 900); }
  }
  else if (t.closest('.tog')) setParam(m, c.id, m.params[c.id] ? 0 : 1);
  else if (t.closest('.ibtn')) showModuleInfo(m);
  else if (t.closest('.pages button')) setExpanded(m, t.closest('.pages button').dataset.page === '1');
  else if (t.closest('.banks button')) setBank(m, t.closest('.banks button').dataset.bank === '1');
});
// A touch that starts on a cable lying over a knob or jack must not scroll the rack: the cable
// itself would let the browser scroll, and the knob turn would be cut off.
svg.addEventListener('touchstart', e => {
  const t = e.touches[0]; if (!t || !e.target.closest('.cable')) return;
  const under = document.elementsFromPoint(t.clientX, t.clientY);
  if (under.some(el => el.classList && (el.classList.contains('knob') || el.classList.contains('jack-wrap'))) || jackNear(t.clientX, t.clientY)) e.preventDefault();
}, { passive: false });
svg.addEventListener('pointerdown', e => {
  const g = e.target.closest('.cable'); if (!g) return;
  e.preventDefault(); e.stopPropagation();
  // Jacks and knobs under a cable win over the cable.
  const under = document.elementsFromPoint(e.clientX, e.clientY);
  const jw = under.find(el => el.classList && el.classList.contains('jack-wrap')) || jackNear(e.clientX, e.clientY);
  const knob = under.find(el => el.classList && el.classList.contains('knob'));
  if (!S.infoMode && jw) return onJackDown(e, jw);
  if (!S.infoMode && knob) return onKnobDown(e, knob);
  if (S.infoMode && (jw || knob)) return showInfo(infoFor(jw || knob));
  if (S.infoMode) return showInfo({ title: 'Cable', text: 'A cable carries exactly one signal from an output to an input. One output can feed many cables, but every input accepts only one. The colour tells you what the cable carries, and cables pulse brighter when a stronger signal flows through them.', tryThis: 'Leave Info Mode and tap a cable to see its signal in the Scope.', extra: '<h3>Cable colours</h3>' + cableLegendHtml(), extraTexts: ['CV'] });
  const c = S.cables.find(x => x.id === g.dataset.cable); if (c) cableSheet(c);
});

// knobs
let lastKnobTap = { el: null, t: 0 };
function onKnobDown(e, knob) {
  e.preventDefault();
  const m = modById(knob.closest('.module').dataset.mod);
  const c = MODULES[m.type].controls.find(x => x.id === knob.closest('.ctl').dataset.ctl);
  const now = performance.now();
  if (lastKnobTap.el === knob && now - lastKnobTap.t < 300) { setParam(m, c.id, c.def); bubble(knob, fmt(c, c.def)); setTimeout(hideBubble, 600); lastKnobTap.el = null; return; }
  lastKnobTap = { el: knob, t: now };
  knob.setPointerCapture && (() => { try { knob.setPointerCapture(e.pointerId); } catch (err) {} })();
  const y0 = e.clientY, n0 = toNorm(c, m.params[c.id]);
  bubble(knob, fmt(c, m.params[c.id]));
  knob.classList.add('active'); document.body.classList.add('turning'); // cables step back while a knob turns
  const move = ev => {
    const v = fromNorm(c, n0 + (y0 - ev.clientY) / 180);
    if (v !== m.params[c.id]) setParam(m, c.id, v);
    bubble(knob, fmt(c, v));
  };
  const up = () => { knob.removeEventListener('pointermove', move); knob.classList.remove('active'); document.body.classList.remove('turning'); hideBubble(); };
  knob.addEventListener('pointermove', move);
  knob.addEventListener('pointerup', up, { once: true });
  knob.addEventListener('pointercancel', up, { once: true });
}
const bubbleEl = $('#bubble');
function bubble(el, text) {
  const r = el.getBoundingClientRect();
  bubbleEl.textContent = text; bubbleEl.hidden = false;
  bubbleEl.style.left = r.left + r.width / 2 + 'px'; bubbleEl.style.top = r.top - 8 + 'px';
}
function hideBubble() { bubbleEl.hidden = true; }

// jacks
function onJackDown(e, jw) {
  e.preventDefault();
  const ref = refFromEl(jw);
  if (S.pending && S.pending.mode === 'tap') {
    const p = S.pending.ref;
    clearPending();
    if (sameRef(p, ref)) return;
    if (compatible(p, ref)) { connect(p, ref); toast(''); return; }
  }
  S.pending = { ref, mode: 'down' };
  highlight(ref);
  jw.setPointerCapture && (() => { try { jw.setPointerCapture(e.pointerId); } catch (err) {} })();
  const x0 = e.clientX, y0 = e.clientY;
  const move = ev => {
    if (S.pending.mode === 'down' && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) S.pending.mode = 'drag';
    if (S.pending.mode !== 'drag') return;
    const wr = rackWrap.getBoundingClientRect();
    if (ev.clientY > wr.bottom - 40) rackWrap.scrollTop += 8; else if (ev.clientY < wr.top + 40) rackWrap.scrollTop -= 8;
    drawTemp(ref, localPoint(ev.clientX, ev.clientY));
  };
  const end = ev => {
    jw.removeEventListener('pointermove', move);
    jw.removeEventListener('pointerup', end); jw.removeEventListener('pointercancel', end);
    if (!S.pending) return;
    if (ev.type === 'pointercancel') { clearPending(); return; }
    if (S.pending.mode === 'drag') {
      const target = ev.type === 'pointerup' && nearestCompatible(ref, ev.clientX, ev.clientY);
      clearPending();
      if (target) connect(ref, target);
    } else {
      S.pending.mode = 'tap';
      // during a guide the panel already says this, and the toast would cover the modules
      if (!document.body.classList.contains('guiding')) toast(ref.dir === 'out' ? 'Now tap a glowing input' : 'Now tap a glowing output');
    }
  };
  jw.addEventListener('pointermove', move);
  jw.addEventListener('pointerup', end); jw.addEventListener('pointercancel', end);
}
function nearestCompatible(ref, x, y) {
  let best = null, bd = 40;
  rack.querySelectorAll('.jack-wrap').forEach(jw => {
    const r = refFromEl(jw); if (!compatible(ref, r)) return;
    const jr = $('.jack', jw).getBoundingClientRect();
    const d = Math.hypot(jr.left + jr.width / 2 - x, jr.top + jr.height / 2 - y);
    if (d < bd) { bd = d; best = r; }
  });
  return best;
}
function highlight(ref) {
  document.body.classList.add('patching');
  rack.querySelectorAll('.jack-wrap').forEach(jw => {
    const r = refFromEl(jw);
    jw.classList.toggle('src', sameRef(r, ref));
    jw.classList.toggle('glow', compatible(ref, r));
  });
}
let tempEl = null;
function drawTemp(ref, p) {
  if (!tempEl) {
    tempEl = makeCableEl({ id: 'temp', sig: ref.dir === 'out' ? signalOf(ref.module, ref.jack) : (ref.kind === 'gate' ? 'gate' : 'audio') });
    tempEl.classList.add('temp');
  }
  const a = jackCenter(ref, ref.dir);
  const d = cablePath(a, p);
  tempEl.querySelectorAll('path').forEach(x => x.setAttribute('d', d));
  const [p1, p2] = tempEl.querySelectorAll('.plug');
  p1.setAttribute('cx', a.x); p1.setAttribute('cy', a.y); p2.setAttribute('cx', p.x); p2.setAttribute('cy', p.y);
}
function clearPending() {
  S.pending = null;
  document.body.classList.remove('patching');
  rack.querySelectorAll('.jack-wrap').forEach(jw => jw.classList.remove('src', 'glow'));
  if (tempEl) { tempEl.remove(); tempEl = null; }
  toast('');
}

// ---------- live visuals ----------
const analysers = new Map();
function analyserFor(modId, jack) {
  const k = modId + ':' + jack;
  if (!analysers.has(k)) {
    const node = modById(modId).inst.outputs[jack];
    const an = engine.ctx.createAnalyser(); an.fftSize = 256;
    node.connect(an);
    analysers.set(k, { an, buf: new Float32Array(256) });
  }
  return analysers.get(k);
}
function peak(modId, jack) {
  const a = analyserFor(modId, jack);
  a.an.getFloatTimeDomainData(a.buf);
  let p = 0; for (let i = 0; i < a.buf.length; i++) { const v = Math.abs(a.buf[i]); if (v > p) p = v; }
  return p;
}
// Live visuals, kept light so the phone stays cool:
// - displays at 30 frames per second, and only for modules that are on screen;
// - cable and LED brightness 15 times per second, in 10 steps, written only when the step changes
//   (every change makes the browser repaint the cable).
let frameN = 0;
const onScreen = new IntersectionObserver(es => { for (const e of es) e.target.__vis = e.isIntersecting; }, { root: rackWrap, rootMargin: '40px' });
const visible = m => m.el.__vis !== false;
const setLvl = (el, v) => { const q = (Math.round(clamp(v, 0, 1) * 10) / 10).toFixed(1); if (el.__lvl !== q) { el.__lvl = q; el.style.setProperty('--lvl', q); } };
function frame() {
  requestAnimationFrame(frame);
  frameN++;
  if (!engine.ctx || document.hidden) return;
  const now = engine.ctx.currentTime;
  if (frameN % 2 === 0 && !S.earHide) for (const m of S.modules) {
    if (!visible(m)) continue;
    if (m.type === 'adsr') drawEnvelope(m, now);
    else if (m.type === 'scope') drawScope(m, now);
    else if (m.type === 'vco') drawWave(m);
    else if (m.type === 'lfo') drawRoll(m, now);
    else if (m.type === 'vcf') drawFilter(m);
    else if (m.type === 'output') drawMeter(m, now);
    else if (m.type === 'keyboard') drawVoices(m);
  }
  if (frameN % 4 === 0 && S.cableMode < 2) {
    for (const c of S.cables) {
      const lvl = c.kind === 'gate' ? (modById(c.from.module).inst.outputs[c.from.jack].isOn(now) ? 1 : 0) : peak(c.from.module, c.from.jack);
      setLvl(c.el, lvl);
    }
    for (const m of S.modules) {
      if (!visible(m)) continue;
      const led = m.el.querySelector('.led'); if (led) setLvl(led, peak(m.id, led.dataset.led));
    }
  }
  if (S.recorder && frameN % 15 === 0) $('#recTime').textContent = timeStr(S.recorder.rec.seconds);
}
// ADSR panel display: the envelope shape from the four knobs, plus a dot that
// shows where the envelope is right now. Times are drawn on a square-root scale
// so a 5 ms attack and a 4 s release both stay visible.
function drawEnvelope(m, now) {
  const cv = m.el.querySelector('canvas.disp'); if (!cv) return;
  const dpr = window.devicePixelRatio || 1, W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'), p = m.params;
  const pad = 4 * dpr, top = 4 * dpr, base = H - 11 * dpr, w = W - pad * 2;
  const seg = [Math.sqrt(p.a), Math.sqrt(p.d), 0.9, Math.sqrt(p.r)], total = seg.reduce((a, b) => a + b, 0);
  const xs = [pad]; seg.forEach(s => xs.push(xs[xs.length - 1] + s / total * w));
  const Y = v => base - v * (base - top);
  // Exp curve (ADR 0010): decay and release fall fast, then slowly (98% after the set time)
  const curve = (x0, x1, from, to) => p.shape === 'exp'
    ? Array.from({ length: 13 }, (_, k) => [x0 + (x1 - x0) * k / 12, Y(to + (from - to) * Math.exp(-4 * k / 12))])
    : [[x1, Y(to)]];
  const pts = [[xs[0], Y(0)], [xs[1], Y(1)], ...curve(xs[1], xs[2], 1, p.s), [xs[3], Y(p.s)], ...curve(xs[3], xs[4], p.s, 0)];
  g.clearRect(0, 0, W, H);
  // stage boundaries and letters
  g.strokeStyle = 'rgba(143,240,192,.12)'; g.lineWidth = 1;
  g.font = `${8 * dpr}px -apple-system, system-ui, sans-serif`; g.textAlign = 'center'; g.fillStyle = 'rgba(143,240,192,.55)';
  ['A', 'D', 'S', 'R'].forEach((l, i) => {
    if (i) { g.beginPath(); g.moveTo(xs[i], top); g.lineTo(xs[i], base); g.stroke(); }
    g.fillText(l, (xs[i] + xs[i + 1]) / 2, H - 2 * dpr);
  });
  // the shape
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
  g.strokeStyle = '#8ff0c0'; g.lineWidth = 1.6 * dpr; g.lineJoin = 'round'; g.stroke();
  g.lineTo(xs[4], base); g.lineTo(xs[0], base); g.fillStyle = 'rgba(143,240,192,.10)'; g.fill();
  // where the envelope is now
  const ev = [...m.inst.gates].reverse().find(e => e.t <= now); if (!ev) return;
  const t = now - ev.t, lerp = (a, b, f) => a + (b - a) * Math.min(1, Math.max(0, f));
  let x;
  if (ev.on) x = t < p.a ? lerp(xs[0], xs[1], t / p.a) : t < p.a + p.d ? lerp(xs[1], xs[2], (t - p.a) / p.d) : lerp(xs[2], xs[3], (t - p.a - p.d) / 2);
  else if (t < p.r) x = lerp(xs[3], xs[4], t / p.r);
  else return;
  const y = Y(m.inst.env.valueAt(now));
  g.beginPath(); g.arc(x, y, 3.2 * dpr, 0, Math.PI * 2); g.fillStyle = '#fff'; g.shadowColor = '#8ff0c0'; g.shadowBlur = 8 * dpr; g.fill(); g.shadowBlur = 0;
}

// L1: small live displays. VCO: two cycles of its wave. LFO: its movement over the last seconds.
// VCF: its filter curve (how much of each frequency gets through), from the filter itself.
function dispCanvas(m) {
  const cv = m.el.querySelector('canvas.disp'); if (!cv || m.el.classList.contains('expanded') && !cv.offsetParent) return null;
  const dpr = window.devicePixelRatio || 1, W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return null;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'); g.clearRect(0, 0, W, H);
  return { g, W, H, dpr };
}
function dispAnalyser(m, size, jack = 'out') {
  if (!m._an || m._anFor !== m.inst) { // a new instance (e.g. after undo) needs a new analyser
    m._an = engine.ctx.createAnalyser(); m._an.fftSize = size; m._anFor = m.inst;
    m.inst.outputs[jack].connect(m._an); m._buf = new Float32Array(size);
  }
  m._an.getFloatTimeDomainData(m._buf);
  return m._buf;
}
const DISP = '#8ff0c0';
function drawWave(m) {
  const d = dispCanvas(m); if (!d) return;
  const { g, W, H, dpr } = d, buf = dispAnalyser(m, 2048), L = buf.length;
  // find two rising zero crossings near the end: one period
  let a = -1, b = -1;
  for (let i = L - 2; i > 1; i--) if (buf[i - 1] < 0 && buf[i] >= 0) { if (b < 0) b = i; else { a = i; break; } }
  let per = a > 0 ? b - a : L >> 2; per = Math.max(8, Math.min(per, L >> 2));
  const start = Math.max(0, (a > 0 ? a : L - 2 * per) - per), n = 2 * per;
  g.strokeStyle = 'rgba(143,240,192,.15)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.strokeStyle = DISP; g.lineWidth = 1.6 * dpr; g.lineJoin = 'round'; g.beginPath();
  for (let i = 0; i <= n; i++) { const x = i / n * W, y = H / 2 - Math.max(-1.1, Math.min(1.1, buf[start + i] || 0)) * H * 0.4; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
}
function drawRoll(m, now) {
  const d = dispCanvas(m); if (!d) return;
  const { g, W, H, dpr } = d, buf = dispAnalyser(m, 256);
  const win = clamp(3 / m.params.rate, 0.6, 6);
  (m._roll ||= []).push({ t: now, v: buf[buf.length - 1] });
  while (m._roll.length && m._roll[0].t < now - 6.5) m._roll.shift();
  g.strokeStyle = 'rgba(143,240,192,.15)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.strokeStyle = DISP; g.lineWidth = 1.6 * dpr; g.lineJoin = 'round'; g.beginPath();
  let first = true, last = null;
  for (const r of m._roll) {
    if (r.t < now - win) continue;
    const x = (r.t - (now - win)) / win * W, y = H / 2 - Math.max(-1.05, Math.min(1.05, r.v)) * H * 0.44;
    first ? g.moveTo(x, y) : g.lineTo(x, y); first = false; last = [x, y];
  }
  g.stroke();
  if (last) { g.beginPath(); g.arc(last[0] - 2 * dpr, last[1], 2.6 * dpr, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); }
}
// Keyboard: one light per voice, lit while that voice plays a note
function drawVoices(m) {
  const d = dispCanvas(m); if (!d || !m.inst.active) return;
  const { g, W, H, dpr } = d, act = m.inst.active(), n = act.length, r = Math.min(H * 0.3, W / (n * 2.6));
  act.forEach((on, k) => {
    const x = W * (k + 0.5) / n;
    g.beginPath(); g.arc(x, H / 2, r, 0, Math.PI * 2);
    g.fillStyle = on ? '#8ff0c0' : 'rgba(143,240,192,.15)'; g.fill();
  });
  if (n === 1) { g.fillStyle = 'rgba(143,240,192,.6)'; g.font = `${8 * dpr}px -apple-system, system-ui, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('mono', W / 2 + r * 2, H / 2); }
}
// M1-12 Output meter: green up to the limiter, yellow while it starts to work, red when it works hard
function drawMeter(m, now) {
  const d = dispCanvas(m); if (!d) return;
  const { g, W, H } = d, buf = dispAnalyser(m, 1024, 'tap');
  let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
  m._hold = pk > (m._hold || 0) || now - (m._holdT || 0) > 1.2 ? (m._holdT = now, pk) : m._hold;
  const X = v => Math.min(1, v / 1.2) * W, zones = [[0, 0.4, '#3fbf6f'], [0.4, 0.8, '#f2c14e'], [0.8, 1.2, '#ff4d47']];
  for (const [a, b, col] of zones) { g.fillStyle = col + '33'; g.fillRect(X(a), 0, X(b) - X(a), H); if (pk > a) { g.fillStyle = col; g.fillRect(X(a), 0, X(Math.min(pk, b)) - X(a), H); } }
  g.fillStyle = '#fff'; g.fillRect(Math.max(0, X(m._hold) - 2), 0, 2, H);
}
const FILTER_DB = [-36, 18];
function drawFilter(m) {
  const d = dispCanvas(m); if (!d || !m.inst.response) return;
  const { g, W, H, dpr } = d, N = Math.max(32, Math.round(W / 3 / dpr) * 2);
  if (!m._freqs || m._freqs.length !== N) { m._freqs = new Float32Array(N); for (let i = 0; i < N; i++) m._freqs[i] = 30 * Math.pow(16000 / 30, i / (N - 1)); }
  const mag = m.inst.response(m._freqs);
  const Y = db => H - (Math.max(FILTER_DB[0], Math.min(FILTER_DB[1], db)) - FILTER_DB[0]) / (FILTER_DB[1] - FILTER_DB[0]) * H;
  // 0 dB line (everything above lets the sound through unchanged) and the cutoff
  g.strokeStyle = 'rgba(143,240,192,.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke();
  const cx = Math.log(m.params.cutoff / 30) / Math.log(16000 / 30) * W;
  g.setLineDash([2 * dpr, 2 * dpr]); g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke(); g.setLineDash([]);
  g.beginPath();
  for (let i = 0; i < N; i++) { const x = i / (N - 1) * W, y = Y(20 * Math.log10(mag[i] + 1e-6)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.strokeStyle = DISP; g.lineWidth = 1.6 * dpr; g.lineJoin = 'round'; g.stroke();
  g.lineTo(W, H); g.lineTo(0, H); g.fillStyle = 'rgba(143,240,192,.12)'; g.fill();
}

// Scope module display (M4-7): two traces on one scale, in the colours of their cables.
// Short windows (≤ 100 ms) show a still picture, triggered on A rising through zero;
// long windows (1 s, 4 s) roll from right to left with the min/max of each frame.
const SCOPE_STEPS = [0.1, 0.2, 0.5, 1, 1.5, 2, 5, 10];
// trace B: a lighter shade of its cable colour, so A and B stay apart when both carry the same kind of signal
const traceColor = (sig, ci) => { const c = signalColor(sig || 'audio'); return ci ? c.replace(/(\d+(?:\.\d+)?)%\)$/, (_, l) => Math.min(90, +l + 24) + '%)') : c; };
function scopeFreq(buf, sr) {
  // rising zero crossings with a little hysteresis, over the whole buffer (about 0.7 s)
  let n = 0, first = -1, last = -1, armed = false, mx = 0;
  for (let i = 0; i < buf.length; i++) mx = Math.max(mx, Math.abs(buf[i]));
  if (mx < 0.02) return 0;
  const h = mx * 0.1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] < -h) armed = true;
    else if (armed && buf[i] >= 0) { armed = false; if (first < 0) first = i; else { n++; last = i; } }
  }
  return n ? n * sr / (last - first) : 0;
}
function noteName(f) {
  const midi = Math.round(69 + 12 * Math.log2(f / 440));
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
function drawScope(m, now) {
  const cv = m.el.querySelector('canvas.disp'); if (!cv) return;
  const dpr = window.devicePixelRatio || 1, W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  const p = m.params, sr = engine.ctx.sampleRate, chans = m.inst.scope, win = p.time;
  const cables = ['a', 'b'].map(j => S.cables.find(c => c.to.module === m.id && c.to.jack === j));
  // read new samples unless frozen
  if (!p.freeze) for (const ch of chans) {
    ch.an.getFloatTimeDomainData(ch.buf);
    if (win >= 1) {
      const k = Math.min(ch.buf.length, Math.max(64, Math.round(sr / 50)));
      let lo = Infinity, hi = -Infinity;
      for (let i = ch.buf.length - k; i < ch.buf.length; i++) { const v = ch.buf[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      ch.roll.push({ t: now, lo, hi });
    }
    while (ch.roll.length && ch.roll[0].t < now - 4.2) ch.roll.shift();
  }
  if (p.freeze && cv.width === W && cv.dataset.drawn) return; // keep the frozen picture
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(143,240,192,.12)'; g.lineWidth = 1;
  for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(W * i / 10, 0); g.lineTo(W * i / 10, H); g.stroke(); }
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, H * i / 4); g.lineTo(W, H * i / 4); g.stroke(); }
  g.strokeStyle = 'rgba(143,240,192,.3)'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  // what to draw: for short windows a slice of samples, for long windows the roll history
  const L = chans[0].buf.length, N = Math.min(L >> 1, Math.round(win * sr));
  let start = L - N;
  if (win < 1) {
    const trig = cables[0] ? chans[0].buf : cables[1] ? chans[1].buf : null;
    if (trig) for (let i = L - N; i > L - 2 * N && i > 1; i--) if (trig[i - 1] < 0 && trig[i] >= 0) { start = i; break; }
  }
  let mx = 0;
  chans.forEach((ch, ci) => {
    if (!cables[ci]) return;
    if (win < 1) for (let i = start; i < start + N; i++) mx = Math.max(mx, Math.abs(ch.buf[i]));
    else for (const r of ch.roll) if (r.t >= now - win) mx = Math.max(mx, Math.abs(r.lo), Math.abs(r.hi));
  });
  const range = p.scale === 'auto' ? (SCOPE_STEPS.find(s => mx <= s) || Math.ceil(mx)) : p.scale;
  const Y = v => H / 2 - Math.max(-1.05, Math.min(1.05, v / range)) * (H * 0.46);
  chans.forEach((ch, ci) => {
    const c = cables[ci]; if (!c) return;
    g.strokeStyle = traceColor(c.sig, ci); g.lineWidth = (ci ? 1.4 : 1.8) * dpr; g.lineJoin = 'round'; g.beginPath();
    if (win < 1) {
      const step = Math.max(1, Math.floor(N / W));
      for (let i = 0; i < N; i += step) { const x = i / N * W, y = Y(ch.buf[start + i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    } else {
      let first = true;
      for (const r of ch.roll) {
        if (r.t < now - win) continue;
        const x = (r.t - (now - win)) / win * W;
        if (first) { g.moveTo(x, Y(r.hi)); first = false; } else g.lineTo(x, Y(r.hi));
        if (r.hi - r.lo > range * 0.02) g.lineTo(x, Y(r.lo)); // fast signals: draw the band they fill
      }
    }
    g.stroke();
  });
  // readouts: scale, and per trace its frequency (sound) or its value right now (slow CV)
  g.font = `600 ${8.5 * dpr}px -apple-system, system-ui, sans-serif`; g.textBaseline = 'top';
  g.fillStyle = 'rgba(143,240,192,.75)'; g.textAlign = 'right'; g.fillText('±' + range, W - 3 * dpr, 3 * dpr);
  g.textAlign = 'left';
  chans.forEach((ch, ci) => {
    const c = cables[ci]; if (!c) return;
    let txt = 'AB'[ci];
    const f = win < 1 ? scopeFreq(ch.buf, sr) : 0;
    if (f > 20 && f < 8000) txt += ` ${f < 100 ? f.toFixed(1) : Math.round(f)} Hz · ${noteName(f)}`;
    else txt += ` ${(ch.buf[ch.buf.length - 1] || 0).toFixed(2)}`;
    g.fillStyle = traceColor(c.sig, ci); g.fillText(txt, 3 * dpr, (3 + ci * 11) * dpr);
  });
  if (!cables[0] && !cables[1]) { g.fillStyle = 'rgba(143,240,192,.45)'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Patch a signal into A or B', W / 2, H / 2); }
  cv.dataset.drawn = p.freeze ? '1' : '';
}

const timeStr = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// ---------- sheets ----------
const sheet = $('#sheet'), sheetBody = $('#sheetBody');
let sheetClose = null;
function openSheet(html, onClose) {
  if (sheetClose) { const f = sheetClose; sheetClose = null; f(); }
  sheetBody.onclick = null;
  sheetBody.innerHTML = html; sheet.hidden = false; sheetClose = onClose || null;
  $('#sheetPanel').scrollTop = 0; // a new sheet starts at its top
  requestAnimationFrame(() => sheet.classList.add('open'));
}
function closeSheet() {
  sheet.classList.remove('open'); sheet.hidden = true;
  if (sheetClose) { const f = sheetClose; sheetClose = null; f(); }
}
$('#sheetBackdrop').addEventListener('click', closeSheet);
sheet.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });

function infoHtml(info) {
  // every abbreviation on the sheet is listed with its meaning at the bottom
  const used = abbrIn(info.title, info.text, info.tryThis, ...(info.extraTexts || []));
  return `<h2>${markAbbr(info.title)}</h2><p>${markAbbr(info.text)}</p>${info.tryThis ? `<p class="try"><b>Try this:</b> ${markAbbr(info.tryThis)}</p>` : ''}${info.extra || ''}
    ${used.length ? `<h3>Abbreviations</h3>${legendHtml(used)}` : ''}<button class="btn wide" data-close>Got it</button>`;
}
function showInfo(info) { openSheet(infoHtml(info)); }
function infoFor(t) {
  const modEl = t.closest('.module'); if (!modEl) return null;
  const m = modById(modEl.dataset.mod), def = MODULES[m.type];
  const jw = t.closest('.jack-wrap');
  if (jw) {
    const j = def[jw.dataset.dir === 'out' ? 'outputs' : 'inputs'].find(x => x.id === jw.dataset.jack);
    const kind = j.kind === 'gate' ? 'Gate' : 'Signal';
    return { title: `${m.name} · ${j.label} (${jw.dataset.dir === 'out' ? 'output' : 'input'}, ${kind})`, text: j.info };
  }
  if (t.closest('.banks')) return { title: `${m.name} · Steps 1–8 and 9–16`, text: 'The sequencer has 16 steps but shows eight at a time, so the knobs stay big enough for a finger. 1–8 shows the first eight, 9–16 the second (on the More page too, for slide and accent). A small light marks the eight that are playing. The loop only reaches steps 9–16 when Steps (More page) is above 8; until then the 9–16 button is dimmed. Switching changes nothing in the sound.' };
  if (t.closest('.pages')) return { title: `${m.name} · Main and More`, text: `This module has two pages of controls. Main shows the controls you need most. More shows the extra controls for fine-tuning (${def.controls.filter(c => c.expert && !c.mini).map(c => c.full || c.label).join(', ')}${def.controls.some(c => c.mini) ? ', and slide and accent per step' : ''}). Switching pages changes nothing in the sound: it only shows other knobs. The values on the hidden page keep working.` };
  if (t.closest('.mhead') && !t.closest('.ibtn')) return { title: `${m.name} · Name bar`, text: 'Tap the name for the module menu (info, duplicate, remove). Drag the name to move the module to another place in the rack; drop it on the bin at the top to remove it. ↶ undoes both.' };
  const box = t.closest('.ctl');
  if (box) { const c = def.controls.find(x => x.id === box.dataset.ctl); return { title: `${m.name} · ${c.full || c.label}`, text: c.info + provText(m.id, c.id) }; }
  return def.info;
}
function showModuleInfo(m) {
  const def = MODULES[m.type];
  const controls = def.controls.filter(c => !c.small)
    .concat(def.controls.filter(c => c.small && !c.stepGate).slice(0, 1).map(c => ({ ...c, label: 'Step knobs', full: null, info: 'The note of each step, in semitones above the lowest note. The buttons 1–8 and 9–16 show the first or the second eight steps.' })))
    .concat(def.controls.filter(c => c.stepGate).slice(0, 1).map(c => ({ ...c, label: 'Step buttons', full: null, info: 'The light button above each step knob switches that step on or off. An off step is a rest.' })));
  const name = i => i.full ? `${i.label} (${i.full})` : i.label;
  const list = (title, items) => items.length ? `<h3>${title}</h3><dl>${items.map(i => `<dt>${markAbbr(name(i))}</dt><dd>${markAbbr(i.info)}</dd>`).join('')}</dl>` : '';
  const all = [...controls, ...def.inputs, ...def.outputs];
  showInfo({ ...def.info, extra: list('Controls', controls) + list('Inputs', def.inputs) + list('Outputs', def.outputs), extraTexts: all.flatMap(i => [name(i), i.info]) });
}

function moduleMenu(m) {
  openSheet(`<h2>${esc(m.name)}</h2>
    <div class="menu">
      <button class="btn" data-a="info">ⓘ About this module</button>
      <div class="row"><button class="btn" data-a="left">◀ Move back</button><button class="btn" data-a="right">Move forward ▶</button></div>
      <p class="hint">Faster: drag the module by its name. Drop it on the bin at the top to remove it.</p>
      <button class="btn" data-a="dup">Duplicate</button>
      <button class="btn danger" data-a="del">Remove module</button>
    </div>`);
  sheetBody.onclick = e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    sheetBody.onclick = null;
    if (a.dataset.a === 'info') return showModuleInfo(m);
    closeSheet();
    if (a.dataset.a === 'left') moveModule(m, -1);
    if (a.dataset.a === 'right') moveModule(m, 1);
    if (a.dataset.a === 'dup') { const next = S.modules[S.modules.indexOf(m) + 1]; addModule(m.type, { ...m.params }, null, { before: next && next.id }); }
    if (a.dataset.a === 'del') removeModule(m);
  };
}

function addSheet() {
  openSheet(`<h2>Add a module</h2><div class="addlist">${MODULE_ORDER.map(t => {
    const d = MODULES[t];
    const full = ABBR[d.name] ? ABBR[d.name].split(':')[0] : '';
    return `<button class="additem" data-t="${t}" style="--accent:${d.accent}"><b>${d.name}${full ? ` <i>${esc(full)}</i>` : ''}</b><span>${markAbbr(d.info.text.split('. ')[0])}.</span></button>`;
  }).join('')}</div>`);
  sheetBody.onclick = e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    sheetBody.onclick = null; closeSheet();
    const m = addModule(b.dataset.t);
    setTimeout(() => m.el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    if (!document.body.classList.contains('guiding')) toast(`${m.name} added. Drag its name to move it, or onto the bin to remove it.`, 3000);
  };
}

// scope
function cableSheet(c) {
  const sm = modById(c.from.module), dm = modById(c.to.module);
  const sj = jackDef(c.from, 'out'), dj = jackDef(c.to, 'in');
  const gate = c.kind === 'gate';
  const sigT = SIGNAL_TYPES[c.sig] || SIGNAL_TYPES.audio;
  openSheet(`<h2><span class="dot" style="background:${signalColor(c.sig)}"></span>${esc(sm.name)} ${esc(sj.label)} → ${esc(dm.name)} ${esc(dj.label)}</h2>
    <p class="hint">This cable carries <b>${sigT.name}</b>: ${sigT.what}.</p>
    <div class="scope"><canvas id="scopeCv"></canvas><span id="scopeRange"></span></div>
    ${gate ? '<p class="hint">Gate signal over the last 3 seconds: up = ON (key held), down = OFF.</p>' :
      `<div class="seg" id="tscale">${[['5 ms', 0.005], ['20 ms', 0.02], ['100 ms', 0.1], ['600 ms', 0.6]].map(([l, v], i) => `<button data-v="${v}" class="${i === 1 ? 'on' : ''}">${l}</button>`).join('')}</div>
       <p class="hint">Time window. Use short windows for audio, long ones to watch slow CV like LFOs and envelopes.</p>`}
    <h3>Cable colours</h3>${cableLegendHtml()}
    <div class="row"><button class="btn danger" id="rmCable">Remove cable</button><button class="btn" data-close>Close</button></div>`, () => { running = false; if (an) try { src.disconnect(an); } catch (e) {} });
  const cv = $('#scopeCv'), g = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  let running = true, win = 0.02, an = null;
  const src = sm.inst.outputs[c.from.jack];
  const col = signalColor(c.sig);
  let data = null, hist = [];
  if (!gate) { an = engine.ctx.createAnalyser(); an.fftSize = 32768; src.connect(an); data = new Float32Array(an.fftSize); }
  $('#rmCable').onclick = () => { closeSheet(); removeCable(c); };
  const ts = $('#tscale');
  if (ts) ts.onclick = e => { const b = e.target.closest('button'); if (!b) return; win = +b.dataset.v; ts.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
  const draw = () => {
    if (!running) return;
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,255,170,.12)'; g.lineWidth = 1;
    for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(W * i / 10, 0); g.lineTo(W * i / 10, H); g.stroke(); }
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, H * i / 6); g.lineTo(W, H * i / 6); g.stroke(); }
    g.strokeStyle = col; g.lineWidth = 2 * dpr; g.beginPath();
    if (gate) {
      hist.push(src.isOn(engine.ctx.currentTime) ? 1 : 0); if (hist.length > 180) hist.shift();
      hist.forEach((v, i) => { const x = W - (hist.length - 1 - i) * W / 179, y = v ? H * 0.2 : H * 0.8; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      $('#scopeRange').textContent = hist[hist.length - 1] ? 'ON' : 'OFF';
    } else {
      an.getFloatTimeDomainData(data);
      const L = data.length, N = Math.min(L >> 1, Math.round(win * engine.ctx.sampleRate));
      let start = L - N;
      if (win <= 0.1) for (let i = L - N; i > L - 2 * N && i > 1; i--) { if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; } }
      if (start + N > L) start = L - N;
      let mx = 0; for (let i = start; i < start + N; i++) mx = Math.max(mx, Math.abs(data[i]));
      const range = mx <= 0.1 ? 0.1 : mx <= 0.5 ? 0.5 : mx <= 1 ? 1 : Math.ceil(mx);
      const step = Math.max(1, Math.floor(N / W));
      for (let i = 0, x = 0; i < N; i += step, x++) {
        const y = H / 2 - (data[start + i] / range) * (H * 0.45);
        const px = i / N * W; i ? g.lineTo(px, y) : g.moveTo(px, y);
      }
      $('#scopeRange').textContent = '±' + range;
    }
    g.stroke();
    requestAnimationFrame(draw);
  };
  draw();
}

// ---------- patches ----------
function serialize() {
  return {
    format: 'modular-synth-sandbox', version: 1,
    modules: S.modules.map(m => {
      const params = { ...m.params };
      MODULES[m.type].controls.filter(c => c.transient).forEach(c => delete params[c.id]);
      const ui = { ...(m.ui && m.ui.expanded ? { expanded: true } : {}), ...(m.ui && m.ui.bank ? { bank: 1 } : {}) };
      return { id: m.id, type: m.type, params, ...(Object.keys(ui).length ? { ui } : {}) };
    }),
    cables: S.cables.map(c => ({ from: { ...c.from }, to: { ...c.to } })),
    ...(S.meta ? { meta: S.meta } : {})
  };
}
function clearRack() {
  voices.teardown();
  [...S.cables].forEach(c => removeCable(c, true));
  [...S.modules].forEach(m => { m.inst.destroy(); onScreen.unobserve(m.el); m.el.remove(); });
  S.modules = []; analysers.clear();
}
function loadPatch(p, opts = {}) {
  if (!p || p.format !== 'modular-synth-sandbox' || !Array.isArray(p.modules)) { toast('That file is not a patch from this app.', 3000); return false; }
  clearPending();
  if (S.recorder) setParam(S.recorder.module, 'rec', 0);
  S.meta = p.meta || null; // set before the modules are drawn, so "≈" marks appear
  S.loading = true;
  clearRack();
  // keep the patch's own module ids (so undo and guides keep pointing at the same modules);
  // new ids continue after the highest "mN" in the patch
  const okId = id => typeof id === 'string' && /^[\w-]{1,40}$/.test(id);
  S.nextId = 1 + Math.max(0, ...p.modules.map(pm => okId(pm.id) && /^[mc]\d+$/.test(pm.id) ? +pm.id.slice(1) : 0));
  const idMap = {}, used = new Set();
  for (const pm of p.modules) {
    if (!MODULES[pm.type]) continue;
    const keep = okId(pm.id) && !used.has(pm.id) ? pm.id : null;
    const m = addModule(pm.type, pm.params, keep, { ui: pm.ui, fromPatch: true }); idMap[pm.id] = m.id; used.add(m.id);
  }
  for (const c of p.cables || []) {
    const fm = idMap[c.from.module], tm = idMap[c.to.module]; if (!fm || !tm) continue;
    const od = jackDef({ module: fm, jack: c.from.jack }, 'out'); if (!od) continue;
    connect({ module: fm, jack: c.from.jack, dir: 'out', kind: od.kind }, { module: tm, jack: c.to.jack, dir: 'in', kind: od.kind });
  }
  S.loading = false;
  voices.rebuild(); cpuCheck();
  recolorCables();
  refreshNames(); layout(); autosave();
  if (!opts.keepScroll) rackWrap.scrollTop = 0;
  return idMap;
}

function askText(title, value, okLabel) {
  return new Promise(resolve => {
    let done = false;
    openSheet(`<h2>${esc(title)}</h2><input id="askInput" class="field" value="${esc(value || '')}" autocomplete="off" enterkeyhint="done">
      <div class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="askOk">${esc(okLabel)}</button></div>`,
      () => { if (!done) resolve(null); });
    const inp = $('#askInput'); setTimeout(() => inp.focus(), 50);
    const ok = () => { const v = inp.value.trim(); if (!v) return; done = true; closeSheet(); resolve(v); };
    $('#askOk').onclick = ok;
    inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
  });
}
function askConfirm(title, text, okLabel) {
  return new Promise(resolve => {
    let done = false;
    openSheet(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="row"><button class="btn" data-close>Cancel</button><button class="btn danger" id="askOk">${esc(okLabel)}</button></div>`,
      () => { if (!done) resolve(false); });
    $('#askOk').onclick = () => { done = true; closeSheet(); resolve(true); };
  });
}

function patchesSheet() {
  const saved = store.get('mss.saved') || {};
  const names = Object.keys(saved).sort();
  openSheet(`<h2>Patches</h2>
    <button class="btn primary" data-a="guide">Build a patch step by step…</button>
    <button class="btn" data-a="library">Classic sounds: famous synth sounds…</button>
    <button class="btn" data-a="ear">Ear challenges: match a sound by ear…</button>
    ${navigator.requestMIDIAccess ? '<button class="btn" data-a="midi">Connect a MIDI keyboard…</button>' : ''}
    <h3>Example patches</h3>
    <div class="plist">${EXAMPLES.map((p, i) => `<button class="pitem" data-ex="${i}"><b>${esc(p.name)}</b><span>${esc(p.description)}</span></button>`).join('')}</div>
    <h3>My patches</h3>
    <div class="plist">${names.length ? names.map(n => `<div class="pitem mine"><button class="pload" data-my="${esc(n)}"><b>${esc(n)}</b></button><button class="pdel" data-del="${esc(n)}" aria-label="Delete">✕</button></div>`).join('') : '<p class="hint">Nothing saved yet. Your current rack is always kept automatically.</p>'}</div>
    <div class="menu">
      <button class="btn" data-a="save">Save current patch as…</button>
      <div class="row"><button class="btn" data-a="export">Export .json</button><button class="btn" data-a="import">Import .json</button></div>
      <button class="btn" data-a="new">New empty rack</button>
      <button class="btn" data-a="intro">Show the introduction again</button>
    </div>`);
  sheetBody.onclick = async e => {
    const t = e.target;
    const ex = t.closest('[data-ex]'), my = t.closest('[data-my]'), del = t.closest('[data-del]'), a = t.closest('[data-a]');
    if (ex) { closeSheet(); guide.stop(); loadPatch(EXAMPLES[+ex.dataset.ex]); toast(EXAMPLES[+ex.dataset.ex].description, 4000); }
    else if (my) { closeSheet(); guide.stop(); loadPatch(saved[my.dataset.my]); }
    else if (del) {
      const n = del.dataset.del;
      if (await askConfirm(`Delete "${n}"?`, 'This removes the patch from this device. Exported files are not affected.', 'Delete')) { delete saved[n]; store.set('mss.saved', saved); toast(`Deleted "${n}"`, 2000); }
      patchesSheet();
    }
    else if (a) {
      const act = a.dataset.a;
      if (act === 'guide') { guide.chooser(); return; }
      if (act === 'library') { librarySheet(); return; }
      if (act === 'ear') { ear.chooser(); return; }
      if (act === 'midi') { closeSheet(); connectMidi(); return; }
      if (act === 'intro') { closeSheet(); guide.stop(); intro.start(); return; }
      if (act === 'save') {
        const n = await askText('Name for this patch', '', 'Save'); if (!n) return patchesSheet();
        saved[n] = { ...serialize(), name: n }; store.set('mss.saved', saved); toast(`Saved "${n}"`, 2000); patchesSheet();
      } else if (act === 'export') {
        const n = await askText('File name', 'my-patch', 'Export'); if (!n) return;
        const blob = new Blob([JSON.stringify({ ...serialize(), name: n }, null, 2)], { type: 'application/json' });
        shareFile(new File([blob], n.replace(/[^\w-]+/g, '-') + '.json', { type: 'application/json' }));
      } else if (act === 'import') { $('#importInput').click(); }
      else if (act === 'new') { if (await askConfirm('Clear the rack?', 'Save or export your current patch first if you want to keep it.', 'Clear rack')) { guide.stop(); loadPatch({ format: 'modular-synth-sandbox', version: 1, modules: [], cables: [] }); toast('Empty rack. Tap + to add modules.', 3000); } }
    }
  };
}
$('#importInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const p = JSON.parse(await f.text()); guide.stop(); if (loadPatch(p)) { closeSheet(); toast('Patch imported'); } }
  catch (err) { toast('Could not read that file.', 3000); }
});
async function shareFile(file) {
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: file.name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- classic sounds library ----------
const dots = n => n ? '●'.repeat(n) + '○'.repeat(5 - n) : '';
function librarySheet() {
  openSheet(`<h2>Classic sounds</h2>
    <p class="hint">Famous synthesizer sounds, rebuilt with the modules in this app. Tap one for its story, what you learn, and the patch.</p>
    <div class="plist">${LIBRARY.map((e, i) => `<button class="pitem lib" data-lib="${i}">
      <b>${esc(e.title)}</b><span>${esc(e.artist)} · ${e.year}</span>
      <span class="meta">${e.patch ? 'Playable patch' : e.guide ? 'Guided build (simplified)' : 'Story and external links'}${e.guide && e.patch ? ' · guided build' : ''}${e.difficulty ? ` · <span class="dots" aria-label="difficulty ${e.difficulty} of 5">${dots(e.difficulty)}</span>` : ''}</span>
    </button>`).join('')}</div>`);
  sheetBody.onclick = e => { const b = e.target.closest('[data-lib]'); if (b) libraryCard(LIBRARY[+b.dataset.lib]); };
}
function libraryCard(e) {
  const list = (title, items) => items && items.length ? `<h3>${title}</h3><ul>${items.map(t => `<li>${markAbbr(t)}</li>`).join('')}</ul>` : '';
  const links = (title, items) => items && items.length ? `<h3>${title}</h3><ul class="links">${items.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>${l.platform ? ` <span class="hint">(${esc(l.platform)})</span>` : ''}</li>`).join('')}</ul>` : '';
  const texts = [e.title, e.artist, ...e.goals, ...e.history, ...e.gear, ...e.facts, ...e.inApp];
  const used = abbrIn(...texts);
  openSheet(`<button class="g-link back" data-back>‹ Classic sounds</button>
    <h2>${markAbbr(e.title)}</h2>
    <p class="hint">${markAbbr(e.artist)} · ${e.year}${e.difficulty ? ` · difficulty <span class="dots">${dots(e.difficulty)}</span>` : ''}</p>
    <div class="row">
      ${e.patch ? '<button class="btn primary" data-act="load">Load the patch</button>' : ''}
      ${e.guide ? `<button class="btn${e.patch ? '' : ' primary'}" data-act="guide">Build it step by step</button>` : ''}
      ${e.patch && e.tutorial.length ? '<button class="btn" data-act="tour">Take the tour</button>' : ''}
    </div>
    ${e.patch ? '<p class="hint">Knobs marked ≈ are starting values the source does not give. Tap ? and then a knob to read where its value comes from.</p>' : ''}
    ${list('What you learn', e.goals)}${list('The story', [...e.history, ...e.facts])}${list('Original gear', e.gear)}
    ${list('In this app', e.inApp)}
    ${links('External patches', e.references)}${links('Sources', e.sources)}
    ${used.length ? `<h3>Abbreviations</h3>${legendHtml(used)}` : ''}`);
  sheetBody.onclick = async ev => {
    if (ev.target.closest('[data-back]')) return librarySheet();
    const a = ev.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'load') {
      if (S.modules.length && !(await askConfirm(`Load “${e.title}”?`, 'This replaces what is in your rack now. You can undo it with ↶.', 'Load'))) return libraryCard(e);
      closeSheet(); guide.stop(); loadPatch(JSON.parse(JSON.stringify(e.patch)));
      toast(`${e.title} loaded. ${S.modules.some(m => m.type === 'sequencer' || m.type === 'arp') ? 'It is playing.' : 'Play the keys.'}`, 3000);
    }
    if (a.dataset.act === 'guide') { closeSheet(); guide.startById(e.guide); }
    if (a.dataset.act === 'tour') {
      if (S.modules.length && !(await askConfirm(`Tour “${e.title}”?`, 'The tour loads the finished patch and replaces what is in your rack now. You can undo it with ↶.', 'Start tour'))) return libraryCard(e);
      closeSheet(); guide.tour(e);
    }
  };
}

// ---------- recording ----------
function startRecording(m, node) {
  if (S.recorder) { const old = S.recorder.module; setParam(old, 'rec', 0); }
  S.recorder = { module: m, rec: new Recorder(engine.out || node, () => { if (S.recorder && S.recorder.module === m) setParam(m, 'rec', 0); }) };
  document.body.classList.add('recording');
}
function stopRecording(m) {
  if (!S.recorder || S.recorder.module !== m) return;
  const secs = S.recorder.rec.seconds;
  const blob = S.recorder.rec.stop(); S.recorder = null;
  document.body.classList.remove('recording');
  const name = 'synth-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.wav';
  openSheet(`<h2>Recording ready</h2><p>${timeStr(secs)} · ${(blob.size / 1048576).toFixed(1)} MB · WAV${secs >= MAX_SECONDS - 0.5 ? ' (stopped at the 5 minute limit)' : ''}</p>
    <audio controls src="${URL.createObjectURL(blob)}"></audio>
    <div class="row"><button class="btn primary" id="shareRec">Save / Share</button><button class="btn" data-close>Discard</button></div>`);
  $('#shareRec').onclick = () => shareFile(new File([blob], name, { type: 'audio/wav' }));
}

// ---------- keyboard bar ----------
const keysEl = $('#keys');
const held = new Map(); // pointerId -> note
// How many octaves the on-screen keys show. "auto" picks as many as fit with
// white keys about 44 px wide: 1 on an iPhone in portrait, 2 in landscape, 3 on an iPad.
const keysPref = () => { const v = store.get('mss.keys'); return [1, 2, 3].includes(v) ? v : 'auto'; };
function keyOctaves() {
  const p = keysPref(); if (p !== 'auto') return p;
  const W = keysEl.clientWidth || window.innerWidth;
  return clamp(Math.floor((W / 44 - 1) / 7), 1, 3);
}
function buildKeys() {
  const octaves = keyOctaves();
  if (keysEl.dataset.octaves === String(octaves)) return;
  [...held.keys()].forEach(releaseKey);
  keysEl.dataset.octaves = octaves;
  const white = [0, 2, 4, 5, 7, 9, 11], blackAfter = { 0: 1, 2: 3, 5: 6, 7: 8, 9: 10 };
  let html = '', wi = 0;
  for (let o = 0; o < octaves; o++) for (const n of white) {
    html += `<div class="wkey" data-n="${o * 12 + n}"></div>`;
    if (blackAfter[n] != null) html += `<div class="bkey" data-n="${o * 12 + blackAfter[n]}" style="--i:${wi}"></div>`;
    wi++;
  }
  html += `<div class="wkey" data-n="${octaves * 12}"></div>`;
  keysEl.innerHTML = html;
  keysEl.style.setProperty('--whites', wi + 1);
  const b = document.getElementById('keysBtn');
  if (b) b.textContent = keysPref() === 'auto' ? `${octaves} oct · auto` : `${octaves} oct`;
}
function cycleKeys() {
  const order = ['auto', 1, 2, 3], next = order[(order.indexOf(keysPref()) + 1) % order.length];
  store.set('mss.keys', next === 'auto' ? null : next);
  keysEl.dataset.octaves = ''; buildKeys();
  toast(next === 'auto' ? `Keys: ${keyOctaves()} octave${keyOctaves() > 1 ? 's' : ''} (fits the screen)` : `Keys: ${next} octave${next > 1 ? 's' : ''}`, 1500);
}
// everything the on-screen keys play: Keyboard modules and Arpeggiators
const keyboards = () => S.modules.filter(m => m.type === 'keyboard' || m.type === 'arp');
function noteOn(n, vel = 0.8) { const ks = keyboards(); ks.forEach(k => k.inst.noteOn(n, vel)); if (ks.length) guide.onNote(); }
function noteOff(n) { keyboards().forEach(k => k.inst.noteOff(n)); }
function keyAt(x, y) { const el = document.elementFromPoint(x, y); return el && el.closest('#keys [data-n]'); }
function pressKey(id, el, y) {
  const n = 12 * (S.octave + 1) + +el.dataset.n;
  // M2-1 velocity: near the front edge of a key = loud, near the back = soft
  const r = el.getBoundingClientRect(), vel = y == null ? 0.8 : clamp(0.3 + 0.7 * (y - r.top) / r.height, 0.3, 1);
  held.set(id, { n, el }); el.classList.add('down'); noteOn(n, vel);
}
function releaseKey(id) {
  const h = held.get(id); if (!h) return;
  held.delete(id); h.el.classList.remove('down'); noteOff(h.n);
}
// The keys and the mod strip cancel the touch start: no long-press magnifier, no text selection
// by repeated taps, no double-tap zoom. Pointer events (which play the notes) still arrive.
let keyTouches = 0;
for (const el of [keysEl, document.getElementById('modStrip')]) {
  el.addEventListener('touchstart', e => { e.preventDefault(); keyTouches = e.touches.length; }, { passive: false });
  el.addEventListener('touchend', e => { keyTouches = [...e.touches].filter(t => el.contains(t.target)).length; });
  el.addEventListener('touchcancel', () => { keyTouches = 0; });
}
keysEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (S.infoMode) return showInfo(MODULES.keyboard.info);
  if (!keyboards().length) toast('These keys belong to a Keyboard or Arp module. Tap + to add one.', 3000);
  const k = keyAt(e.clientX, e.clientY); if (!k) return;
  keysEl.setPointerCapture && (() => { try { keysEl.setPointerCapture(e.pointerId); } catch (err) {} })();
  pressKey(e.pointerId, k, e.clientY);
});
keysEl.addEventListener('pointermove', e => {
  const h = held.get(e.pointerId); if (!h) return;
  const k = keyAt(e.clientX, e.clientY);
  if (k && k !== h.el) { const old = h; held.delete(e.pointerId); old.el.classList.remove('down'); pressKey(e.pointerId, k, e.clientY); noteOff(old.n); }
});
['pointerup', 'pointercancel'].forEach(t => keysEl.addEventListener(t, e => releaseKey(e.pointerId)));
// M2-2 mod strip: slide to send 0..1 from every Keyboard's Mod output; the value stays (like a mod wheel)
const modStrip = $('#modStrip');
function setMod(v) {
  S.mod = clamp(v, 0, 1);
  modStrip.style.setProperty('--v', S.mod); modStrip.setAttribute('aria-valuenow', S.mod.toFixed(2));
  S.modules.forEach(m => m.inst.setMod && m.inst.setMod(S.mod));
}
modStrip.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (S.infoMode) return showInfo({ title: 'Mod strip', text: MODULES.keyboard.outputs.find(o => o.id === 'mod').info });
  try { modStrip.setPointerCapture(e.pointerId); } catch (err) {}
  const at = ev => { const r = modStrip.getBoundingClientRect(); setMod(1 - (ev.clientY - r.top) / r.height); };
  at(e);
  const move = ev => at(ev), up = () => { modStrip.removeEventListener('pointermove', move); modStrip.removeEventListener('pointerup', up); modStrip.removeEventListener('pointercancel', up); };
  modStrip.addEventListener('pointermove', move); modStrip.addEventListener('pointerup', up); modStrip.addEventListener('pointercancel', up);
});
modStrip.addEventListener('dblclick', () => setMod(0));

// M2-6 MIDI keyboard (where the browser supports Web MIDI): notes and velocity go to the same modules as the screen keys
async function connectMidi() {
  if (!navigator.requestMIDIAccess) return toast('This browser cannot use MIDI keyboards (Safari on iPhone does not support Web MIDI).', 3500);
  try {
    const midi = await navigator.requestMIDIAccess();
    const hook = () => { for (const input of midi.inputs.values()) input.onmidimessage = onMidi; };
    hook(); midi.onstatechange = hook;
    const n = [...midi.inputs.values()].length;
    toast(n ? `MIDI connected: ${n} input${n > 1 ? 's' : ''}. Play your keyboard.` : 'No MIDI keyboard found. Plug one in; it connects automatically.', 3000);
  } catch (e) { toast('MIDI access was not allowed.', 2500); }
}
function onMidi(e) {
  const [st, d1, d2] = e.data, cmd = st & 0xf0;
  if (cmd === 0x90 && d2 > 0) noteOn(d1, d2 / 127);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOff(d1);
  else if (cmd === 0xb0 && d1 === 1) setMod(d2 / 127); // mod wheel
}

function setOctave(o) {
  S.octave = clamp(o, 0, 6);
  $('#octLabel').textContent = 'C' + S.octave;
  [...held.keys()].forEach(releaseKey);
}
// the keyboard bar folds away to a thin strip, so the rack gets the room (remembered on this device)
function setKeysFolded(on, quiet) {
  [...held.keys()].forEach(releaseKey);
  document.body.classList.toggle('keys-folded', !!on);
  store.set('mss.keysFolded', on ? 1 : null);
  requestAnimationFrame(() => { layout(); buildKeys(); });
  if (!quiet) toast(on ? 'Keys hidden. Tap ▴ Keys to bring them back.' : '', on ? 2200 : 1);
}
$('#kbdFold').onclick = () => setKeysFolded(true);
$('#kbdShow').onclick = () => setKeysFolded(false);
if (store.get('mss.keysFolded')) setKeysFolded(true, true);
$('#octDown').onclick = () => setOctave(S.octave - 1);
$('#keysBtn').onclick = cycleKeys;
window.addEventListener('resize', () => buildKeys());
$('#octUp').onclick = () => setOctave(S.octave + 1);
// computer keyboard for desktop testing
const KEYMAP = 'awsedftgyhujkolp;';
const typingInField = e => e.target instanceof Element && !!e.target.closest('input,textarea');
window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typingInField(e)) { e.preventDefault(); undo(); return; }
  if (e.repeat || e.metaKey || e.ctrlKey || typingInField(e)) return;
  if (e.key === 'Escape' && S.pending) { clearPending(); toast(''); return; }
  const i = KEYMAP.indexOf(e.key); if (i < 0) return;
  const el = keysEl.querySelector(`[data-n="${i}"]`); if (el) pressKey('k' + e.key, el);
});
window.addEventListener('keyup', e => releaseKey('k' + e.key));

// ---------- top bar ----------
let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast'); clearTimeout(toastTimer);
  if (!msg) { t.classList.remove('show'); return; }
  t.textContent = msg; t.classList.add('show');
  // every message can be closed with a tap; one that stays (no time limit) shows a ✕ for that
  t.classList.toggle('stays', !ms);
  if (ms) toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
$('#toast').addEventListener('click', () => { clearTimeout(toastTimer); $('#toast').classList.remove('show'); });
$('#infoBtn').onclick = () => {
  S.infoMode = !S.infoMode; clearPending();
  document.body.classList.toggle('info-mode', S.infoMode);
  $('#infoBtn').classList.toggle('on', S.infoMode);
  toast(S.infoMode ? 'Info Mode: tap any module, knob or jack to learn what it does.' : '', S.infoMode ? 0 : 1);
};
$('#addBtn').onclick = addSheet;
$('#patchBtn').onclick = patchesSheet;
const CABLE_MODES = ['Cables: solid', 'Cables: see-through', 'Cables: hidden (tap again to show)'];
$('#cableBtn').onclick = () => {
  S.cableMode = (S.cableMode + 1) % 3;
  document.body.dataset.cables = S.cableMode;
  $('#cableBtn').setAttribute('aria-label', CABLE_MODES[S.cableMode]);
  toast(CABLE_MODES[S.cableMode], 1500);
};
$('#zoomBtn').onclick = () => setScale(S.scale > 0.75 ? 0.5 : 1);
$('#undoBtn').onclick = undo;

// tap any marked abbreviation to see its meaning
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('abbr.ab'); if (!a) return;
  e.stopPropagation(); toast(`${a.dataset.ab} = ${ABBR[a.dataset.ab]}`, 3500);
}, true);

// ---------- guided builds ----------
const guide = initGuide({
  S, MODULES, $, esc, modById, jackDef, addModule, connect, setParam, previewParam, fmtValue, loadPatch, fromNorm, layout,
  openSheet, closeSheet, askConfirm, toast, clearPending, serialize, store,
  beforePanel: () => ear.stop(), earChooser: () => ear.chooser()
});
const ear = initEar({
  S, MODULES, $, esc, modById, loadPatch, setParam, toNorm, layout, openSheet, closeSheet, voices,
  beforePanel: () => guide.stop()
});
$('#guideBtn').onclick = () => guide.chooser();
// in the background (other app, other tab, screen off) the audio stops computing, unless a recording runs;
// it starts again when the app comes back (engine.js)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && engine.ctx && !S.recorder && engine.ctx.state === 'running') engine.ctx.suspend();
  if (!document.hidden) setTimeout(soundCheck, 600); // back in front: did the sound come back by itself?
});
// When the phone stopped the sound and it did not come back on its own, say how to get it back;
// the next touch anywhere restarts it (engine.js) and the hint goes away.
const SILENT_MSG = 'The phone paused the sound. Tap anywhere to turn it back on.';
function soundCheck() {
  const st = engine.ctx && engine.ctx.state;
  if (!st || document.hidden) return;
  if (st !== 'running') { S.silentHint = true; toast(SILENT_MSG); }
  else if (S.silentHint) { S.silentHint = false; if ($('#toast').textContent === SILENT_MSG) toast(''); }
}
engine.onState = () => setTimeout(soundCheck, 300);
// guide text that does not fit fades out at the bottom, so it is clear there is more to scroll
const guidePanel = $('#guide');
function updateFade() { const b = guidePanel.querySelector('.g-body'); if (b) b.classList.toggle('more-below', b.scrollHeight - b.scrollTop - b.clientHeight > 4); }
new MutationObserver(() => requestAnimationFrame(updateFade)).observe(guidePanel, { childList: true });
guidePanel.addEventListener('scroll', updateFade, true);
window.addEventListener('resize', () => requestAnimationFrame(updateFade));
const intro = initIntro({ store });

// ---------- start ----------
buildKeys(); setOctave(3);
$('#startBtn').addEventListener('click', async () => {
  const ctx = startAudio(); ctx.resume(); // resume inside the tap: iOS only unlocks audio there
  $('#start').remove();
  await engine.ready; // the AudioWorklet modules must be loaded before the first VCO is built
  const saved = store.get('mss.current');
  if (!(saved && saved.modules && loadPatch(saved))) loadPatch(EXAMPLES[0]);
  setTimeout(() => intro.startOnce(), 450); // first start only: four hints with a spotlight
  requestAnimationFrame(frame);
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.mss = S; window.mssDrawCables = drawCables; window.mssVoices = voices; window.mssLoad = loadPatch; window.mssEar = ear; window.mssGuide = guide; // handy for debugging in the console
