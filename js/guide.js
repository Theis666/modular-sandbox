// Guided Build runner: shows one step at a time, spotlights where to tap,
// and advances when the rack reaches the step's goal.
import { GUIDES, CONCEPTS } from './guides.js';
import { EXAMPLES } from './patches.js';
import { abbrIn, markAbbr, legendHtml } from './abbr.js';
// CHALLENGES is read only inside functions: in the Artifact bundle ear.js comes after this file
import { CHALLENGES } from './ear.js';

export function initGuide(api) {
  const { S, MODULES, $, esc } = api;
  const panel = $('#guide'), spot = $('#spot'), spot2 = $('#spot2');
  let G = null, lastTarget = null, lastScroll = 0, raf = null;

  const step = () => G && G.guide.steps[G.i];

  // ----- L4: chapters, saved progress, concepts learned -----
  const PKEY = 'mss.guides';
  const saved = () => { const d = api.store.get(PKEY) || {}; return { progress: d.progress || {}, done: d.done || [], concepts: d.concepts || [] }; };
  const putSaved = d => api.store.set(PKEY, d);
  const chapterStarts = g => (g.chapters || []).map(([name, title]) => ({ name, i: g.steps.findIndex(s => s.title === title) })).filter(c => c.i >= 0).sort((a, b) => a.i - b.i);
  const chapterOf = (g, i) => {
    const cs = chapterStarts(g); let k = -1;
    cs.forEach((c, j) => { if (c.i <= i) k = j; });
    return k < 0 ? null : { k, n: cs.length, name: cs[k].name, start: cs[k].i };
  };
  function saveProgress() {
    if (!G || G.finished) return;
    const d = saved();
    d.progress[G.guide.id] = { i: G.i, alias: G.alias, patch: api.serialize(), t: Date.now() };
    putSaved(d);
  }
  function markFinished() {
    const d = saved(), g = G.guide;
    delete d.progress[g.id];
    if (!d.done.includes(g.id)) d.done.push(g.id);
    for (const c of g.concepts || []) if (!d.concepts.includes(c)) d.concepts.push(c);
    putSaved(d);
  }
  const LEVELS = ['', 'Beginner', 'Some experience', 'Advanced'];
  const levelBadge = n => n ? `<span class="lvl l${n}" title="${LEVELS[n]}" aria-label="Difficulty: ${LEVELS[n]}">${'●'.repeat(n)}${'○'.repeat(3 - n)}</span>` : '';
  const conceptChips = (ids, learned) => `<div class="concepts">${ids.map(c => CONCEPTS[c] ? `<span data-c="${c}" class="concept${learned.includes(c) ? ' on' : ''}" title="${esc(CONCEPTS[c][1])}">${learned.includes(c) ? '✓ ' : ''}${markAbbr(CONCEPTS[c][0])}</span>` : '').join('')}</div>`;
  const modEl = alias => { const id = G.alias[alias]; const m = id && api.modById(id); return m ? m.el : null; };
  const jackEl = (alias, jack, dir) => { const el = modEl(alias); return el && el.querySelector(`.jack-wrap[data-dir="${dir}"][data-jack="${jack}"] .jack`); };
  const ref = (alias, jack, dir) => {
    const id = G.alias[alias]; if (!id || !api.modById(id)) return null;
    const def = api.jackDef({ module: id, jack }, dir);
    return def && { module: id, jack, dir, kind: def.kind };
  };

  // ----- goal checks -----
  function claimModule(type) {
    const used = new Set(Object.values(G.alias));
    return S.modules.find(m => m.type === type && !used.has(m.id));
  }
  function reached(s) {
    switch (s.do) {
      case 'add': { const m = claimModule(s.type); if (m) { G.alias[s.as] = m.id; return true; } return false; }
      case 'cable': {
        const f = G.alias[s.from[0]], t = G.alias[s.to[0]];
        return S.cables.some(c => c.from.module === f && c.from.jack === s.from[1] && c.to.module === t && c.to.jack === s.to[1]);
      }
      case 'set': { const m = api.modById(G.alias[s.mod]); return !!m && s.test(m.params[s.param]); }
      case 'play': return G.notes >= 2;
      default: return false;
    }
  }

  // ----- where to tap -----
  function targets(s) {
    switch (s.do) {
      case 'add': {
        const item = !$('#sheet').hidden && document.querySelector(`.additem[data-t="${s.type}"]`);
        return [item || $('#addBtn')];
      }
      case 'cable': {
        const a = jackEl(s.from[0], s.from[1], 'out'), b = jackEl(s.to[0], s.to[1], 'in');
        const p = S.pending && S.pending.ref;
        const pendingIs = (alias, jack, dir) => p && p.module === G.alias[alias] && p.jack === jack && p.dir === dir;
        if (pendingIs(s.to[0], s.to[1], 'in')) return [a, b];
        if (pendingIs(s.from[0], s.from[1], 'out')) return [b, a];
        return [a, b];
      }
      case 'set': {
        const el = modEl(s.mod); const box = el && el.querySelector(`[data-ctl="${s.param}"]`);
        // the control sits on the other page of the module (ADR 0010): point at that page's tab first
        if (box && !box.offsetParent && el.querySelector('.pages')) return [el.querySelector(`.pages [data-page="${box.closest('.controls.expert') ? 1 : 0}"]`)];
        return [box && (box.querySelector('.knob, .sel, .tog') || box)];
      }
      case 'play': return [document.body.classList.contains('keys-folded') ? $('#kbdShow') : $('#keys')];
      case 'next': return [$('#guideNext')];
    }
    return [];
  }

  // The frame lives inside the area that scrolls (rack or sheet), so it scrolls with its target
  // instead of trailing behind it. Only the rack is dimmed around it; the guide text stays readable.
  function place(el, box, pad) {
    if (!el || !el.isConnected) { box.hidden = true; return; }
    const r = el.getBoundingClientRect();
    if (!r.width) { box.hidden = true; return; }
    // In the rack the frame is part of the rack layer itself, so it scrolls and zooms with the modules
    // exactly (no lag): positions are in the rack's own, unzoomed units.
    const inRack = !!el.closest('#rack');
    const host = inRack ? $('#rack') : el.closest('#sheetPanel') ? $('#sheetPanel') : document.body;
    if (box.parentNode !== host) host.appendChild(box);
    box.classList.toggle('inside', host !== document.body);
    box.classList.toggle('dim', inRack);
    box.classList.toggle('in-sheet', host.id === 'sheetPanel');
    let ox = 0, oy = 0, k = 1;
    if (inRack) { const h = host.getBoundingClientRect(); ox = h.left; oy = h.top; k = S.scale || 1; }
    else if (host !== document.body) { const h = host.getBoundingClientRect(); ox = h.left + host.clientLeft - host.scrollLeft; oy = h.top + host.clientTop - host.scrollTop; }
    box.hidden = false;
    box.style.left = (r.left - ox) / k - pad + 'px'; box.style.top = (r.top - oy) / k - pad + 'px';
    box.style.width = r.width / k + pad * 2 + 'px'; box.style.height = r.height / k + pad * 2 + 'px';
  }

  let tick = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    // 20 times a second is plenty: the frame sits in the rack layer and moves with it by itself
    if (++tick % 3) return;
    if (!G || G.finished || G.inBreak) { spot.hidden = spot2.hidden = true; return; }
    const s = step();
    if (!G.completed && reached(s)) complete();
    if (G.completed) { spot.hidden = spot2.hidden = true; return; }
    const [main, other] = targets(s);
    const now = performance.now();
    if (main && (main !== lastTarget || now - lastScroll > 700)) {
      lastTarget = main;
      const wrap = $('#rackWrap').contains(main) ? $('#rackWrap') : $('#sheetPanel').contains(main) ? $('#sheetPanel') : null;
      if (wrap) {
        const r = main.getBoundingClientRect(), w = wrap.getBoundingClientRect();
        if (r.top < w.top + 10 || r.bottom > w.bottom - 10 || r.left < w.left || r.right > w.right)
          // 'nearest' scrolls only as far as needed, so the rack never jumps into the empty space below it
          { main.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); lastScroll = now; }
      }
    }
    place(main, spot, 6);
    place(other, spot2, 4);
  }

  // ----- panel -----
  function render() {
    const s = step(), n = G.guide.steps.length;
    panel.hidden = false; document.body.classList.add('guiding');
    if (G.compare) return renderCompare(s, n);
    panel.classList.toggle('folded', !!G.folded);
    if (G.folded) {
      // one line, so the rack gets the room while you patch
      panel.innerHTML = `
        <div class="g-bar thin"><i style="width:${(G.i + (G.completed ? 1 : 0)) / n * 100}%"></i></div>
        <div class="g-mini">
          <span class="g-title${G.completed ? ' done' : ''}"><span class="g-check">✓</span><span class="g-mini-title">${markAbbr(s.title)}</span></span>
          <span class="g-count">${G.i + 1}/${n}</span>
          ${s.do === 'next' ? '<button id="guideNext" class="btn primary small">Next</button>' : ''}
          <button id="guideMin" class="g-link" aria-label="Show the explanation">Show</button>
          <button id="guideExit" class="winbtn" aria-label="Close the guide (progress is kept)">✕</button>
        </div>`;
      $('#guideMin').onclick = () => { G.folded = false; G.keepFolded = false; render(); };
      $('#guideExit').onclick = close;
      const nx = $('#guideNext'); if (nx) nx.onclick = complete;
      requestAnimationFrame(api.layout);
      return;
    }
    panel.innerHTML = `
      <div class="g-top"><span class="g-count">${esc(G.guide.name)} · Step ${G.i + 1} of ${n}</span>
        <button id="guideMin" class="winbtn" aria-label="Make the guide small">–</button>
        <button id="guideExit" class="winbtn" aria-label="Close the guide (progress is kept)">✕</button></div>
      <div class="g-bar"><i style="width:${(G.i + (G.completed ? 1 : 0)) / n * 100}%"></i></div>
      <div class="g-body">
      ${(ch => ch ? `<p class="g-chapter">Chapter ${ch.k + 1} of ${ch.n} · ${esc(ch.name)}</p>` : '')(chapterOf(G.guide, G.i))}
      <h3 class="g-title${G.completed ? ' done' : ''}"><span class="g-check">✓</span>${markAbbr(s.title)}</h3>
      <p class="g-text">${markAbbr(s.text)}</p><p class="g-why"><b>Why:</b> ${markAbbr(s.why)}</p>${legendHtml(abbrIn(s.title, s.text, s.why), true)}
      </div>
      <div class="g-actions">
        ${s.do === 'next' ? '<button id="guideNext" class="btn primary">Next</button>' : `<button id="guideSkip" class="btn">Do it for me</button>`}
      </div>`;
    $('#guideExit').onclick = close;
    $('#guideMin').onclick = () => { G.folded = true; G.keepFolded = true; render(); }; // stays folded until you tap Show
    const nx = $('#guideNext'); if (nx) nx.onclick = complete;
    const sk = $('#guideSkip'); if (sk) sk.onclick = doItForMe;
    requestAnimationFrame(api.layout);
  }
  // L3: after a knob step, let the learner hear the change by flipping between the old and new value
  function renderCompare(s, n) {
    const c = G.compare, m = api.modById(G.alias[s.mod]);
    // what makes sound right now: a running Sequencer or Clock, the keys, or a tone that is always on
    const running = api.S.modules.some(x => (x.type === 'sequencer' || x.type === 'clock' || x.type === 'arp') && (x.params.run || x.params.hold));
    const hint = running ? 'Listen while it plays' : api.S.modules.some(x => x.type === 'keyboard' || x.type === 'arp') ? 'Play a note on the keys' : 'Listen';
    panel.classList.remove('folded');
    panel.innerHTML = `
      <div class="g-top"><span class="g-count">${esc(G.guide.name)} · Step ${G.i + 1} of ${n}</span>
        <button id="guideExit" class="winbtn" aria-label="Close the guide (progress is kept)">✕</button></div>
      <div class="g-bar"><i style="width:${(G.i + 1) / n * 100}%"></i></div>
      <div class="g-body">
      <h3 class="g-title done"><span class="g-check">✓</span>${markAbbr(s.title)}</h3>
      <p class="g-text"><b>Hear the difference.</b> ${hint}, then switch between before and after.</p>
      <div class="seg compare" role="group" aria-label="Compare">
        <button data-ab="before" class="${c.showing === 'before' ? 'on' : ''}">Before · ${esc(api.fmtValue(m, s.param, c.before))}</button>
        <button data-ab="after" class="${c.showing === 'after' ? 'on' : ''}">After · ${esc(api.fmtValue(m, s.param, c.after))}</button>
      </div>
      </div>
      <div class="g-actions"><button id="guideNext" class="btn primary">Next</button></div>`;
    panel.querySelectorAll('[data-ab]').forEach(b => b.onclick = () => showCompare(b.dataset.ab));
    $('#guideNext').onclick = endCompare;
    $('#guideExit').onclick = close;
    requestAnimationFrame(api.layout);
  }
  function showCompare(which) {
    const c = G.compare, s = step(), m = api.modById(G.alias[s.mod]); if (!m) return;
    if (c.showing === 'after') c.after = m.params[s.param]; // keep any further tweaks as the "after"
    c.showing = which;
    api.previewParam(m, s.param, which === 'before' ? c.before : c.after);
    render();
  }
  function endCompare() {
    const c = G.compare; if (!c) return;
    const s = step(), m = api.modById(G.alias[s.mod]);
    if (m && c.showing === 'before') api.previewParam(m, s.param, c.after);
    G.compare = null;
    enter(G.i + 1);
  }

  function renderFinish() {
    panel.innerHTML = `
      <div class="g-top"><span class="g-count">${esc(G.guide.name)} · complete</span><button id="guideExit" class="winbtn" aria-label="Close">✕</button></div>
      <div class="g-bar"><i style="width:100%"></i></div>
      <div class="g-body">
      <h3 class="g-title done"><span class="g-check">✓</span>You built “${esc(G.guide.name)}”</h3>
      <p class="g-text">Keep playing and tweaking. Tap ? and then any knob to learn what it does, or save this patch from the ☰ menu.</p>
      ${(G.guide.concepts || []).length ? `<p class="g-why"><b>What you learned:</b></p>${conceptChips(G.guide.concepts, G.guide.concepts)}` : ''}
      </div>
      <div class="g-actions"><button id="guideMore" class="btn">Another guide</button><button id="guideClose" class="btn primary">Done</button></div>`;
    $('#guideExit').onclick = $('#guideClose').onclick = stop;
    $('#guideMore').onclick = () => { stop(); chooser(); };
    requestAnimationFrame(api.layout);
  }

  function enter(i) {
    G.i = i; G.notes = 0; G.completed = false; lastTarget = null; G.inBreak = false;
    G.folded = !!G.keepFolded; // a new step opens again, unless you chose Hide
    if (i >= G.guide.steps.length) { G.finished = true; markFinished(); renderFinish(); return; }
    const ch = chapterOf(G.guide, i);
    if (ch && ch.start === i && i > 0 && G.breakDone !== i) { saveProgress(); return renderBreak(ch); }
    const s = G.guide.steps[i];
    if (s.do === 'set') { const m = api.modById(G.alias[s.mod]); G.before = m ? m.params[s.param] : undefined; }
    render();
    saveProgress();
  }
  // L4: a pause between chapters; progress is saved, so stopping here is safe
  function renderBreak(ch) {
    G.inBreak = true;
    const prev = chapterStarts(G.guide)[ch.k - 1];
    panel.hidden = false; panel.classList.remove('folded'); document.body.classList.add('guiding');
    panel.innerHTML = `
      <div class="g-top"><span class="g-count">${esc(G.guide.name)} · Step ${G.i + 1} of ${G.guide.steps.length}</span><button id="guideExit" class="winbtn" aria-label="Close the guide (progress is kept)">✕</button></div>
      <div class="g-bar"><i style="width:${G.i / G.guide.steps.length * 100}%"></i></div>
      <div class="g-body">
      <h3 class="g-title done"><span class="g-check">✓</span>Chapter ${ch.k} done${prev ? ': ' + esc(prev.name) : ''}</h3>
      <p class="g-text">Next: <b>Chapter ${ch.k + 1} of ${ch.n} · ${esc(ch.name)}</b>. Your progress is saved. You can take a break and continue later from the Guide list, exactly here.</p>
      </div>
      <div class="g-actions"><button id="guideStop" class="btn">Stop for now</button><button id="guideNext" class="btn primary">Continue</button></div>`;
    $('#guideNext').onclick = () => { G.breakDone = G.i; enter(G.i); };
    $('#guideStop').onclick = close;
    $('#guideExit').onclick = close;
    requestAnimationFrame(api.layout);
  }
  function complete() {
    if (!G || G.completed) return;
    const s = step();
    if (s.do === 'set' && G.before !== undefined) {
      const m = api.modById(G.alias[s.mod]);
      const ctl = m && MODULES[m.type].controls.find(x => x.id === s.param);
      if (ctl && ctl.type !== 'toggle') { // an on/off switch needs no comparison
        G.completed = true; G.compare = { before: G.before, after: m.params[s.param], showing: 'after' };
        render(); return;
      }
    }
    G.completed = true; render();
    clearTimeout(G.timer);
    G.timer = setTimeout(() => enter(G.i + 1), step().do === 'next' ? 150 : 900);
  }

  function doItForMe() {
    const s = step();
    if (s.do === 'add') {
      api.closeSheet();
      // a module of this type that no step uses yet counts: add one only when there is none
      if (reached(s)) return complete();
      api.addModule(s.type); return;
    }
    if (s.do === 'cable') {
      const a = ref(s.from[0], s.from[1], 'out'), b = ref(s.to[0], s.to[1], 'in');
      if (!a || !b) return api.toast('A module this step needs was removed. Exit the guide and start it again.', 3500);
      api.clearPending(); api.connect(a, b); return;
    }
    if (s.do === 'set') {
      const m = api.modById(G.alias[s.mod]); if (!m) return api.toast('That module was removed. Exit the guide and start it again.', 3500);
      const c = MODULES[m.type].controls.find(x => x.id === s.param);
      const candidates = c.type === 'select' ? c.options : c.type === 'toggle' ? [1, 0]
        : Array.from({ length: 201 }, (_, k) => api.fromNorm(c, k / 200));
      // pick the passing value closest to the current one, so the change is small and visible
      const ok = candidates.filter(v => s.test(v));
      if (!ok.length) return;
      const cur = m.params[s.param];
      // numbers: a value a few steps inside the goal, so the display clearly shows the goal is met
      const v = typeof cur === 'number' ? [...ok].sort((x, y) => Math.abs(x - cur) - Math.abs(y - cur))[Math.min(3, ok.length - 1)] : ok[0];
      api.setParam(m, s.param, v); return;
    }
    complete();
  }

  // ----- start / stop -----
  function start(guide, resume) {
    api.beforePanel && api.beforePanel();
    stop();
    if (resume) {
      api.loadPatch(resume.patch);
      G = { guide, i: resume.i, alias: { ...resume.alias }, notes: 0, folded: false, keepFolded: false, breakDone: resume.i };
    } else {
      const d = saved(); delete d.progress[guide.id]; putSaved(d);
      const base = guide.base == null ? { format: 'modular-synth-sandbox', version: 1, modules: [], cables: [] } : EXAMPLES[guide.base];
      const idMap = api.loadPatch(base);
      G = { guide, i: 0, alias: { ...(idMap || {}) }, notes: 0, folded: false, keepFolded: false };
    }
    api.toast('');
    enter(G.i);
    if (!raf) frame();
    // goal check also runs on a timer, so progress never depends on animation frames
    G.poll = setInterval(() => { if (G && !G.finished && !G.inBreak && !G.completed && reached(step())) complete(); }, 250);
  }
  // ----- I4: Tour through a finished Classic sound -----
  let T = null;
  function tourStart(entry) {
    api.beforePanel && api.beforePanel();
    stop();
    api.loadPatch(JSON.parse(JSON.stringify(entry.patch)));
    T = { e: entry, i: 0 };
    document.body.classList.add('guiding', 'touring');
    tourRender();
  }
  function tourRender() {
    const steps = T.e.tutorial, n = steps.length, t = steps[T.i];
    document.querySelectorAll('.module.tour-focus').forEach(el => el.classList.remove('tour-focus'));
    const els = (t.focus || []).map(id => api.modById(id)).filter(Boolean).map(m => m.el);
    els.forEach(el => el.classList.add('tour-focus'));
    const names = (t.focus || []).map(id => api.modById(id)).filter(Boolean).map(m => MODULES[m.type].name);
    const playing = S.modules.some(m => (m.type === 'sequencer' && m.params.run) || (m.type === 'arp' && m.params.hold));
    panel.hidden = false; panel.classList.remove('folded');
    panel.innerHTML = `
      <div class="g-top"><span class="g-count">Tour · ${esc(T.e.title)} · ${T.i + 1} of ${n}</span>
        <button id="guideExit" class="winbtn" aria-label="Close the tour">✕</button></div>
      <div class="g-bar"><i style="width:${(T.i + 1) / n * 100}%"></i></div>
      <div class="g-body">
      <p class="g-text">${markAbbr(t.text)}</p>
      ${names.length ? `<p class="g-why"><b>Look at:</b> ${[...new Set(names)].map(x => { const k = names.filter(y => y === x).length; return (k > 1 ? k + ' × ' : '') + markAbbr(x); }).join(', ')} (lit up in the rack).</p>` : ''}
      ${T.i === 0 ? `<p class="g-why">${playing ? 'The patch is playing.' : 'Play the keys while you read.'} Turn any knob to hear what it does; ↶ undoes it.</p>` : ''}
      ${legendHtml(abbrIn(t.text, ...names), true)}
      </div>
      <div class="g-actions">
        ${T.i > 0 ? '<button id="tourBack" class="btn">Back</button>' : ''}
        <button id="tourNext" class="btn primary">${T.i + 1 < n ? 'Next' : 'Finish'}</button>
      </div>`;
    $('#guideExit').onclick = stop;
    const bk = $('#tourBack'); if (bk) bk.onclick = () => { T.i--; tourRender(); };
    $('#tourNext').onclick = () => { if (T.i + 1 < n) { T.i++; tourRender(); } else stop(); };
    requestAnimationFrame(() => {
      api.layout();
      if (els[0]) els[0].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }

  // ✕ on the panel: progress stays saved, so this is like closing a window, not losing work
  function close() {
    const wasGuide = G && !G.finished;
    stop();
    if (wasGuide) api.toast('Guide closed. Your progress is saved: Guide → Continue.', 2500);
  }
  function stop() {
    if (T) { T = null; document.body.classList.remove('touring'); document.querySelectorAll('.module.tour-focus').forEach(el => el.classList.remove('tour-focus')); }
    if (G && G.compare && G.compare.showing === 'before') { const s = step(), m = api.modById(G.alias[s.mod]); if (m) api.previewParam(m, s.param, G.compare.after); }
    if (G) { clearTimeout(G.timer); clearInterval(G.poll); }
    G = null; panel.hidden = true; panel.innerHTML = '';
    spot.hidden = spot2.hidden = true;
    document.body.classList.remove('guiding');
    requestAnimationFrame(api.layout);
  }

  function chooser() {
    const d = saved();
    const status = g => {
      const p = d.progress[g.id];
      if (p) { const ch = chapterOf(g, p.i); return `<span class="meta prog">▶ Continue at step ${p.i + 1} of ${g.steps.length}${ch ? ` · chapter ${ch.k + 1} of ${ch.n}` : ''}</span>`; }
      return `<span class="meta">${d.done.includes(g.id) ? '<b class="done-mark">✓ Done</b> · ' : ''}${g.steps.length} steps${g.chapters ? ` in ${g.chapters.length} chapters` : ''} · ${g.base == null ? 'starts from an empty rack' : `starts from the ${esc(EXAMPLES[g.base].name)}`}</span>`;
    };
    const all = [...new Set(GUIDES.flatMap(g => g.concepts || []))];
    // groups fold open and shut; which ones are open is remembered. Inside a group: easiest first.
    const open = api.store.get('mss.guideOpen') || { basics: true };
    const item = g => `<button class="pitem gitem" data-g="${GUIDES.indexOf(g)}">
        <span class="gi-head"><b>${esc(g.name)}</b>${levelBadge(g.level)}</span>
        <span>${markAbbr(g.description)}</span>
        ${status(g)}</button>`;
    const group = (key, title, list, extra = '') => {
      const sorted = [...list].sort((a, b) => (a.level || 1) - (b.level || 1));
      const done = sorted.filter(g => d.done.includes(g.id)).length;
      return `<details class="ggroup" data-key="${key}"${open[key] ? ' open' : ''}><summary><b>${title}</b><span>${sorted.length} guides${done ? ` · ${done} done` : ''}</span></summary>
        ${extra}<div class="plist">${sorted.map(item).join('')}</div></details>`;
    };
    const going = GUIDES.filter(g => d.progress[g.id]).sort((a, b) => d.progress[b.id].t - d.progress[a.id].t);
    api.openSheet(`<h2>Guided builds</h2>
      <p class="hint">Pick a patch to build. The guide tells you which module to add next, where to tap, and why. Your progress is saved. ${levelBadge(1)} beginner, ${levelBadge(2)} some experience, ${levelBadge(3)} advanced.</p>
      ${going.length ? `<h3>Continue</h3><div class="plist">${going.map(item).join('')}</div>` : ''}
      ${group('basics', 'Basics', GUIDES.filter(g => !g.classic && !g.cat))}
      ${group('drums', 'Drums', GUIDES.filter(g => g.cat === 'drums'))}
      ${group('classic', 'Classic sounds', GUIDES.filter(g => !!g.classic), '<p class="hint">Famous synth sounds, rebuilt step by step, with a little of their history.</p>')}
      <details class="ggroup" data-key="concepts"${open.concepts ? ' open' : ''}><summary><b>Concepts</b><span>${d.concepts.filter(c => all.includes(c)).length} of ${all.length} learned</span></summary>
        <p class="hint">Each finished guide ticks off the ideas it teaches. Tap a concept to read what it means.</p>
        ${conceptChips(all, d.concepts)}
        <p class="hint" id="conceptText"></p></details>
      <details class="ggroup" data-key="ear"${open.ear ? ' open' : ''}><summary><b>Train your ears</b><span>${CHALLENGES.length} challenges</span></summary>
        <p class="hint">No steps, no hints at first: the app plays a target sound and you match it by ear.</p>
        <div class="row"><button class="btn" data-ear>Ear challenges…</button></div></details>`);
    $('#sheetBody').querySelectorAll('details.ggroup').forEach(det => det.addEventListener('toggle', () => {
      const o = api.store.get('mss.guideOpen') || { basics: true }; o[det.dataset.key] = det.open; api.store.set('mss.guideOpen', o);
    }));
    $('#sheetBody').onclick = e => {
      const c = e.target.closest('.concept');
      if (c) { const id = c.dataset.c; $('#conceptText').innerHTML = `<b>${markAbbr(CONCEPTS[id][0])}:</b> ${markAbbr(CONCEPTS[id][1])}`; return; }
      if (e.target.closest('[data-ear]')) return api.earChooser();
      const b = e.target.closest('[data-g]'); if (b) pick(GUIDES[+b.dataset.g], chooser);
    };
  }
  // start a guide, offering to continue where the learner stopped
  async function pick(g, back) {
    const p = saved().progress[g.id];
    if (!p) {
      if (S.modules.length && !(await api.askConfirm(`Start “${g.name}”?`, 'The guide replaces what is in your rack now. You can undo it with ↶.', 'Start guide'))) return back && back();
      api.closeSheet(); return start(g);
    }
    const ch = chapterOf(g, p.i);
    api.openSheet(`<h2>${esc(g.name)}</h2>
      <p class="hint">You stopped at step ${p.i + 1} of ${g.steps.length}${ch ? `, in chapter ${ch.k + 1} of ${ch.n}: ${esc(ch.name)}` : ''}. Either way the guide replaces what is in your rack now (↶ undoes it).</p>
      <div class="row"><button class="btn" data-r="new">Start over</button><button class="btn primary" data-r="go">Continue</button></div>`);
    $('#sheetBody').onclick = e => {
      const r = e.target.closest('[data-r]'); if (!r) return;
      api.closeSheet(); start(g, r.dataset.r === 'go' ? p : null);
    };
  }

  // Fold when a touch in the rack ends (not when it starts), so nothing moves under the finger mid-gesture.
  $('#rack').addEventListener('pointerup', () => {
    // not on a chapter break or a before/after comparison: those panels have no step to fold, and
    // drawing the step there left the guide stuck on its break (no goal checks, ever more modules)
    if (G && !G.finished && !G.inBreak && !G.compare && !G.folded && !S.infoMode) { G.folded = true; render(); }
    // a tour keeps its panel open: it has no task in the rack
  }, true);

  return {
    start, stop, chooser,
    tour: tourStart,
    touring: () => !!T,
    async startById(id) {
      const g = GUIDES.find(x => x.id === id); if (!g) return;
      return pick(g);
    },
    active: () => !!G,
    goalReached: () => !!G && !G.finished && !G.inBreak && reached(step()),
    currentTargets: () => (G && (G.compare || G.inBreak) ? [$('#guideNext')] : G && !G.finished && !G.completed ? targets(step()) : []),
    onNote() { if (G) G.notes++; }
  };
}
