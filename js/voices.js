// Polyphony (ADR 0008). The rack shows one copy of every module. When a Keyboard has
// Voices > 1, every module behind it (only these types) gets hidden copies, one per extra
// voice, wired exactly like the visible one. Effects and the Output stay single: all voices
// meet there, turned down a little so chords do not get louder and louder.
// The visible module is voice 0; its jacks, scope, lights and envelope display show voice 0.
export const POLY_TYPES = new Set(['vco', 'noise', 'vcf', 'vca', 'adsr', 'lfo', 'mixer', 'dx', 'fold', 'ring', 'atten', 'slew', 'quant', 'sh']);

export function initVoices({ S, MODULES, engine, modById }) {
  let built = null; // { copies: Map(modId -> [inst for voice 1..n-1]), undo: [fn], region }
  const noHooks = { step() {}, rec() {} };

  // Which modules are polyphonic, and with how many voices: everything of a poly type
  // that can be reached by cables from a Keyboard with Voices > 1.
  function regionOf() {
    const reg = new Map(); // modId -> { n, kb }
    for (const kb of S.modules) {
      const n = Math.round(kb.type === 'keyboard' ? kb.params.voices || 1 : 1);
      if (n < 2) continue;
      const queue = [kb.id];
      while (queue.length) {
        const id = queue.shift();
        for (const c of S.cables) {
          if (c.from.module !== id) continue;
          const t = modById(c.to.module);
          if (!t || reg.has(t.id) || !POLY_TYPES.has(t.type)) continue;
          reg.set(t.id, { n, kb: kb.id }); queue.push(t.id);
        }
      }
    }
    return reg;
  }

  function teardown() {
    if (!built) return;
    for (const u of built.undo.reverse()) { try { u(); } catch (e) {} }
    for (const list of built.copies.values()) for (const inst of list) { try { inst.destroy(); } catch (e) {} }
    built = null;
  }

  function link(src, dst, kind) {
    if (!src || !dst) return;
    if (kind === 'gate') { src.listeners.add(dst); built.undo.push(() => src.listeners.delete(dst)); }
    else { src.connect(dst); built.undo.push(() => src.disconnect(dst)); }
  }

  function rebuild() {
    teardown();
    const reg = regionOf();
    markUi(reg);
    if (!engine.ctx || !reg.size) return;
    built = { copies: new Map(), undo: [], region: reg };
    for (const [id, r] of reg) {
      const m = modById(id), list = [];
      // the copies share the module's params object, so they start from the same settings
      for (let k = 1; k < r.n; k++) list.push(MODULES[m.type].create(engine.ctx, m.params, noHooks));
      built.copies.set(id, list);
    }
    // the output of module `m` for voice k (or null when it has no such voice)
    const outOf = (m, jack, k, kbId) => {
      if (m.type === 'keyboard' && m.id === kbId && m.inst.voice) return m.inst.voice(k)[jack];
      const r = reg.get(m.id); if (!r || r.kb !== kbId) return null;
      return k === 0 ? m.inst.outputs[jack] : built.copies.get(m.id)[k - 1].outputs[jack];
    };
    for (const c of S.cables) {
      const A = modById(c.from.module), B = modById(c.to.module); if (!A || !B) continue;
      const rb = reg.get(B.id), ra = reg.get(A.id);
      if (rb) {
        // into a poly module: voice k gets voice k of the source, or the single source shared by all
        for (let k = 1; k < rb.n; k++) {
          const src = outOf(A, c.from.jack, k, rb.kb) || A.inst.outputs[c.from.jack];
          link(src, built.copies.get(B.id)[k - 1].inputs[c.to.jack], c.kind);
        }
      } else if (ra && c.kind !== 'gate') {
        // poly → single (an effect or the Output): all voices meet here, through one trim
        const src0 = A.inst.outputs[c.from.jack], dst = B.inst.inputs[c.to.jack];
        const trim = engine.ctx.createGain(); trim.gain.value = 1 / Math.sqrt(ra.n);
        try { src0.disconnect(dst); } catch (e) {}
        src0.connect(trim); trim.connect(dst);
        for (let k = 1; k < ra.n; k++) built.copies.get(A.id)[k - 1].outputs[c.from.jack].connect(trim);
        built.undo.push(() => {
          trim.disconnect(); try { src0.disconnect(trim); } catch (e) {}
          if (S.cables.includes(c)) src0.connect(dst); // put the plain cable back if it still exists
        });
      }
    }
  }

  // thicker cables and a ×n badge, so it is visible which part of the patch is polyphonic
  function markUi(reg) {
    for (const m of S.modules) {
      if (!m.el) continue; // offline renders have no panel
      const r = reg.get(m.id);
      m.el.classList.toggle('poly', !!r);
      if (r) m.el.dataset.voices = '×' + r.n; else delete m.el.dataset.voices;
    }
    for (const c of S.cables) {
      const rb = reg.get(c.to.module), A = modById(c.from.module);
      const poly = !!rb && (reg.has(c.from.module) || (A && A.id === rb.kb));
      if (c.el) c.el.classList.toggle('poly', poly);
    }
  }

  return {
    rebuild, teardown,
    // a knob turned on the visible module also turns it on the hidden copies
    set(m, id, v) { const list = built && built.copies.get(m.id); if (list) list.forEach(inst => inst.set(id, v)); },
    // how many hidden copies are running (for tests and the info text)
    count: () => (built ? [...built.copies.values()].reduce((a, l) => a + l.length, 0) : 0)
  };
}
