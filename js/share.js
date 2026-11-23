// Patch sharing via link: the whole patch travels in the part of the link after "#",
// which the browser never sends to a server (GitHub Pages sees only the page address).
// Format: #p=z.<data> (deflate-raw, base64url) or #p=j.<data> (plain JSON, base64url) where
// CompressionStream is missing. A patch from a link is someone else's data: sanitize() keeps only
// module types, controls and jacks this app knows, with values inside their ranges.
import { MODULES } from './modules.js';

const b64url = bytes => {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = str => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export async function encodePatch(patch) {
  const json = new TextEncoder().encode(JSON.stringify(patch));
  if (typeof CompressionStream === 'function') {
    try { return 'z.' + b64url(await pipe(json, new CompressionStream('deflate-raw'))); } catch (e) {}
  }
  return 'j.' + b64url(json);
}

const MAX_TEXT = 200000; // a decoded patch larger than this is not one of ours
export async function decodePatch(code) {
  const m = /^([zj])\.([\w-]+)$/.exec(code || ''); if (!m) return null;
  let bytes = unb64url(m[2]);
  if (m[1] === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('nodecompress');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  }
  if (bytes.length > MAX_TEXT) return null;
  return sanitize(JSON.parse(new TextDecoder().decode(bytes)));
}

const okId = id => typeof id === 'string' && /^[\w-]{1,40}$/.test(id);
const num = v => typeof v === 'number' && Number.isFinite(v);

export function sanitize(p) {
  if (!p || typeof p !== 'object' || p.format !== 'modular-synth-sandbox' || !Array.isArray(p.modules)) return null;
  const modules = [], types = {};
  for (const pm of p.modules.slice(0, 80)) {
    const def = pm && MODULES[pm.type]; if (!def || !okId(pm.id) || types[pm.id]) continue;
    const params = {}, src = pm.params && typeof pm.params === 'object' ? pm.params : {};
    for (const c of def.controls) {
      if (!(c.id in src)) continue;
      const v = src[c.id];
      if (c.type === 'select') { const i = c.options.findIndex(o => o === v); if (i >= 0) params[c.id] = c.options[i]; }
      else if (c.type === 'toggle') { if (v === 0 || v === 1 || v === true || v === false) params[c.id] = v ? 1 : 0; }
      else if (num(v)) params[c.id] = Math.min(c.max, Math.max(c.min, v));
    }
    // the Arp keeps a held chord in the patch
    if (Array.isArray(src.notes)) params.notes = src.notes.filter(num).slice(0, 16);
    const ui = {};
    if (pm.ui && pm.ui.expanded === true) ui.expanded = true;
    if (pm.ui && pm.ui.bank === 1) ui.bank = 1;
    modules.push({ id: pm.id, type: pm.type, params, ...(Object.keys(ui).length ? { ui } : {}) });
    types[pm.id] = def;
  }
  const cables = [];
  for (const c of Array.isArray(p.cables) ? p.cables.slice(0, 200) : []) {
    const f = c && c.from, t = c && c.to; if (!f || !t) continue;
    const fd = types[f.module], td = types[t.module]; if (!fd || !td) continue;
    if (!fd.outputs.some(j => j.id === f.jack) || !td.inputs.some(j => j.id === t.jack)) continue;
    cables.push({ from: { module: f.module, jack: f.jack }, to: { module: t.module, jack: t.jack } });
  }
  return { format: 'modular-synth-sandbox', version: 1, modules, cables };
}
