"""Convert Idea/patches.json (read only) + tools/library-en.json into js/library.js.

Usage: python3 tools/convert-library.py

- Numbers and wiring come from Idea/patches.json; English words from tools/library-en.json.
- The result uses this app's own patch format (see ADR 0005) plus a `meta` block that
  records, per knob, whether its value is from the source or inferred (shown as "≈").
- Sounds the source only describes can carry our own recreation in library-en.json ('own': status,
  patch in this app's format, and which knobs come from a source). Those knobs are marked ≈ unless sourced.
- Two cables into one input are joined with an automatically added Mixer, because every
  input in this app takes exactly one cable.
"""
import json, math, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = json.loads((ROOT / 'Idea' / 'patches.json').read_text())
EN = json.loads((ROOT / 'tools' / 'library-en.json').read_text())

GUIDES = {'i-feel-love-bass': 'ifeellove', 'dx7-epiano-1': 'dx7epiano', 'stranger-things-arp': 'strangerthings', 'oxygene-iv-lead': 'oxygene', 'blade-runner-brass': 'bladerunner', 'on-the-run-sequence': 'ontherun'}  # existing guided builds
TYPE = {'VCO': 'vco', 'SUB': 'vco', 'NOISE': 'noise', 'LFO': 'lfo', 'MIXER': 'mixer', 'VCF': 'vcf', 'VCA': 'vca',
        'ENV': 'adsr', 'SEQ': 'sequencer', 'ARP': 'arp', 'KEYBOARD': 'keyboard', 'CHORUS': 'chorus',
        'DELAY': 'delay', 'REVERB': 'reverb', 'OUTPUT': 'output'}
PORT = {('VCF', 'cutoffMod'): 'cutoff', ('VCF', 'envMod'): 'cutoff'}
WAVE = {'saw': 'sawtooth', 'square': 'square', 'pulse': 'square', 'triangle': 'triangle', 'sine': 'sine',
        'smoothRandom': 'random', 'sampleHold': 'sh'}
FILTER = {'lp12': 'lowpass', 'lp24': 'lowpass24', 'hp12': 'highpass', 'bp': 'bandpass'}
ARPMODE = {'up': 'up', 'down': 'down', 'upDown': 'updown', 'downUp': 'downup', 'random': 'random'}
DIV = {'1/8': 2, '1/16': 4, '1/32': 8}
REVERB_TONE = {'spring': 2500, 'plate': 7000, 'hall': 5000}
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

def clamp(v, a, b): return max(a, min(b, v))
def midi(name):  # "C3" -> 48 (this app: C3 = 48), "Bb2" -> 46
    n = NOTE[name[0]]; i = 1
    while i < len(name) and name[i] in '#b': n += 1 if name[i] == '#' else -1; i += 1
    return n + 12 * (int(name[i:]) + 1)
def val(p, k, d=None): return p[k]['value'] if k in p else d

def convert(src, en):
    mods, cables, meta = [], [], {}
    notes = en.get('notes', {})
    by_id = {m['id']: m for m in src['modules']}
    tempo = val(src, 'tempoBpm') if 'tempoBpm' in src else None
    tempo = tempo or next((val(m['params'], 'bpm') for m in src['modules'] if m['type'] == 'SEQ'), 120)

    def mark(mid, param, json_mod, json_param, prov=None, note=None):
        jp = json_mod['params'].get(json_param, {}) if json_mod else {}
        entry = {'prov': prov or jp.get('provenance', 'inferred')}
        n = note or notes.get(f"{json_mod['id']}.{json_param}" if json_mod else '')
        if n: entry['note'] = n
        if 'raw' in jp: entry['raw'] = jp['raw']
        meta.setdefault(mid, {})[param] = entry

    # keyboards that only feed an arpeggiator are dropped: the Arp listens to the keys itself
    feeds = {c['from'].split('.')[0] for c in src['connections']}
    arp_only = {m['id'] for m in src['modules'] if m['type'] == 'KEYBOARD'
                and all(by_id[c['to'].split('.')[0]]['type'] == 'ARP' for c in src['connections'] if c['from'].startswith(m['id'] + '.'))}
    vco_octaves = [val(m['params'], 'octave', 0) for m in src['modules'] if m['type'] == 'VCO']

    # sequencer: notes relative to the lowest one; the VCOs it plays move by whole octaves
    seq_shift = 0
    for m in src['modules']:
        if m['type'] == 'SEQ' and 'pitchSet' in m['params']:
            ns = [midi(n) for n in val(m['params'], 'pitchSet')]
            seq_shift = (min(ns) - 48) // 12

    for m in src['modules']:
        t, jp, mid = m['type'], m['params'], m['id']
        if mid in arp_only: continue
        p = {}
        if t in ('VCO', 'SUB'):
            p['wave'] = WAVE[val(jp, 'waveform', 'saw')]; mark(mid, 'wave', m, 'waveform')
            if t == 'SUB':  # one octave below the lower oscillator
                p['tune'] = clamp(min(vco_octaves) - 1, -3, 3)
                mark(mid, 'tune', None, None, 'inferred', 'Sub oscillator: one octave below the lower oscillator.')
            else:
                p['tune'] = clamp(val(jp, 'octave', 0), -3, 3); mark(mid, 'tune', m, 'octave')
                p['fine'] = clamp(val(jp, 'fineCents', 0), -100, 100); mark(mid, 'fine', m, 'fineCents')
            if any(c['to'] == f'{mid}.pitch' and by_id[c['from'].split('.')[0]]['type'] == 'SEQ' for c in src['connections']):
                p['tune'] = clamp(p['tune'] + seq_shift, -3, 3)
            if any(c['to'] == f'{mid}.fm' and by_id[c['from'].split('.')[0]]['type'] == 'LFO' for c in src['connections']):
                p['fm'] = round(1 / 12, 4)  # LFO depth 1 = 100 cents (IMPLEMENTATION.md: depth * 100)
                mark(mid, 'fm', None, None, 'inferred', 'Set so that LFO Depth 1 bends the pitch by 100 cents.')
        elif t == 'KEYBOARD':
            if val(jp, 'voices', 1) > 1:
                p['voices'] = clamp(val(jp, 'voices'), 1, 8); mark(mid, 'voices', m, 'voices')
        elif t == 'NOISE':
            p['level'] = val(jp, 'level', 0.6)
        elif t == 'LFO':
            p['wave'] = WAVE[val(jp, 'waveform', 'sine')]; mark(mid, 'wave', m, 'waveform')
            p['rate'] = clamp(val(jp, 'rateHz', 2), 0.05, 20); mark(mid, 'rate', m, 'rateHz')
            p['depth'] = clamp(val(jp, 'depth', 0.5), 0, 1); mark(mid, 'depth', m, 'depth')
        elif t == 'MIXER':
            for i in (1, 2, 3):
                if f'level{i}' in jp: p[f'l{i}'] = val(jp, f'level{i}'); mark(mid, f'l{i}', m, f'level{i}')
        elif t == 'VCF':
            p['type'] = FILTER[val(jp, 'mode', 'lp12')]; mark(mid, 'type', m, 'mode')
            p['cutoff'] = clamp(val(jp, 'cutoffHz', 1200), 30, 16000); mark(mid, 'cutoff', m, 'cutoffHz')
            p['res'] = clamp(val(jp, 'resonance', 0.2), 0, 1); mark(mid, 'res', m, 'resonance')
            if 'envAmount' in jp:  # source scale: envAmount 1 = 6 octaves; here CV Amt 1 = 4 octaves
                p['cv'] = round(clamp(val(jp, 'envAmount') * 1.5, -1.5, 1.5), 3); mark(mid, 'cv', m, 'envAmount')
            else:
                p['cv'] = 1; mark(mid, 'cv', None, None, 'inferred', 'No amount in the source: four octaves at full envelope.')
            if 'keyTrack' in jp: p['track'] = val(jp, 'keyTrack'); mark(mid, 'track', m, 'keyTrack')
        elif t == 'VCA':
            p['level'] = 0; p['cv'] = val(jp, 'gain', 1); mark(mid, 'cv', m, 'gain')
        elif t == 'ENV':
            p['a'] = clamp(val(jp, 'attackMs', 10) / 1000, 0.001, 4); mark(mid, 'a', m, 'attackMs')
            p['d'] = clamp(val(jp, 'decayMs', 300) / 1000, 0.005, 10); mark(mid, 'd', m, 'decayMs')
            p['s'] = clamp(val(jp, 'sustain', 0.6), 0, 1); mark(mid, 's', m, 'sustain')
            p['r'] = clamp(val(jp, 'releaseMs', 400) / 1000, 0.005, 10); mark(mid, 'r', m, 'releaseMs')
        elif t == 'SEQ':
            p['tempo'] = val(jp, 'bpm', 120); mark(mid, 'tempo', m, 'bpm')
            active = val(jp, 'stepActive', [True] * 8)
            ns = [midi(n) for n in val(jp, 'pitchSet', ['C3'])]
            low = min(ns); rel = [n - low for n in ns]; k = 0
            for i in range(8):
                p[f'g{i + 1}'] = 1 if active[i % len(active)] else 0; mark(mid, f'g{i + 1}', m, 'stepActive')
                if active[i % len(active)]: p[f's{i + 1}'] = rel[k % len(rel)]; k += 1
                else: p[f's{i + 1}'] = rel[0]
                mark(mid, f's{i + 1}', m, 'pitchSet')
            p['len'] = 0.5; p['run'] = 1
        elif t == 'ARP':
            p['mode'] = ARPMODE[val(jp, 'mode', 'up')]; mark(mid, 'mode', m, 'mode')
            p['div'] = val(jp, 'division', '1/16'); mark(mid, 'div', m, 'division')
            p['hold'] = 1 if val(jp, 'hold', False) else 0; mark(mid, 'hold', m, 'hold')
            p['offset'] = val(jp, 'offset', 0); mark(mid, 'offset', m, 'offset')
            p['tempo'] = tempo; mark(mid, 'tempo', None, None, src.get('tempoBpm', {}).get('provenance', 'inferred'))
            kb = next((k for k in src['modules'] if k['type'] == 'KEYBOARD' and 'heldChord' in k['params']), None)
            if kb: p['notes'] = [midi(n) for n in val(kb['params'], 'heldChord')]
        elif t == 'CHORUS':
            p['rate'] = val(jp, 'rateHz', 0.8); mark(mid, 'rate', m, 'rateHz')
            p['depth'] = val(jp, 'depth', 0.5); mark(mid, 'depth', m, 'depth')
            p['mix'] = val(jp, 'mix', 0.5); mark(mid, 'mix', m, 'mix')
        elif t == 'DELAY':
            if 'sync' in jp:
                p['time'] = round(60 / tempo / DIV[val(jp, 'sync')], 4); mark(mid, 'time', m, 'sync')
            else:
                p['time'] = clamp(val(jp, 'timeMs', 250) / 1000, 0.02, 1); mark(mid, 'time', m, 'timeMs')
            p['fb'] = clamp(val(jp, 'feedback', 0.3), 0, 0.9); mark(mid, 'fb', m, 'feedback')
            p['mix'] = val(jp, 'mix', 0.5); mark(mid, 'mix', m, 'mix')
        elif t == 'REVERB':
            p['size'] = clamp(val(jp, 'decayS', 1.8), 0.3, 6); mark(mid, 'size', m, 'decayS')
            p['tone'] = REVERB_TONE.get(val(jp, 'type', 'hall'), 5000); mark(mid, 'tone', m, 'type')
            p['type'] = {'spring': 'spring', 'plate': 'plate'}.get(val(jp, 'type', 'hall'), 'room'); mark(mid, 'type', m, 'type')
            p['mix'] = val(jp, 'mix', 0.3); mark(mid, 'mix', m, 'mix')
        elif t == 'OUTPUT':
            # several oscillators summed in a mixer get loud; lower the output so the limiter does not squash them
            osc_mix = sum(val(x['params'], f'level{i}', 0) for x in src['modules'] if x['type'] == 'MIXER'
                          for i in (1, 2, 3) if any(c['to'] == f"{x['id']}.in{i}" and by_id[c['from'].split('.')[0]]['type'] in ('VCO', 'SUB', 'NOISE') for c in src['connections']))
            p['vol'] = val(jp, 'level', round(0.8 / max(1, osc_mix), 2))
            mark(mid, 'vol', m, 'level', None if 'level' in jp else 'inferred',
                 None if 'level' in jp else ('Lowered because several oscillators are mixed, so the sound does not overload.' if osc_mix > 1 else None))
        mods.append({'id': mid, 'type': TYPE[t], 'params': p})

    # cables; several cables into one input are joined by a Mixer
    targets = {}
    for c in src['connections']:
        fm, fj = c['from'].split('.'); tm, tj = c['to'].split('.')
        if fm in arp_only or by_id[tm]['type'] == 'ARP' and tj == 'notes': continue
        tj = PORT.get((by_id[tm]['type'], tj), tj)
        targets.setdefault((tm, tj), []).append((fm, fj))
    for (tm, tj), srcs in targets.items():
        if len(srcs) == 1:
            cables.append({'from': {'module': srcs[0][0], 'jack': srcs[0][1]}, 'to': {'module': tm, 'jack': tj}}); continue
        mix_id = f'{tm}_{tj}_mix'
        mp = {}
        for i, (fm, fj) in enumerate(srcs[:3], 1):
            amount = val(by_id[fm]['params'], 'amount', 1)
            mp[f'l{i}'] = amount
            meta.setdefault(mix_id, {})[f'l{i}'] = {'prov': by_id[fm]['params'].get('amount', {}).get('provenance', 'inferred'),
                                                    'note': f'Amount of {fm} (from the source).' if 'amount' in by_id[fm]['params'] else 'Joins two cables into one input.'}
            cables.append({'from': {'module': fm, 'jack': fj}, 'to': {'module': mix_id, 'jack': f'in{i}'}})
        cables.append({'from': {'module': mix_id, 'jack': 'out'}, 'to': {'module': tm, 'jack': tj}})
        pos = next(i for i, m in enumerate(mods) if m['id'] == tm)
        mods.insert(pos, {'id': mix_id, 'type': 'mixer', 'params': mp})

    # key tracking: the pitch that plays the first VCO also goes to the filter's Key input
    for m in src['modules']:
        if m['type'] == 'VCF' and 'keyTrack' in m['params']:
            first_vco = next(x['id'] for x in src['modules'] if x['type'] == 'VCO')
            pitch_src = next((c['from'] for c in src['connections'] if c['to'] == f'{first_vco}.pitch'), None)
            if pitch_src:
                fm, fj = pitch_src.split('.')
                cables.append({'from': {'module': fm, 'jack': fj}, 'to': {'module': m['id'], 'jack': 'key'}})

    return {'format': 'modular-synth-sandbox', 'version': 1, 'name': en['title'],
            'modules': mods, 'cables': cables, 'meta': {'library': src['id'], 'params': meta}}

def own_patch(en):
    """A recreation of ours (no settings in the source): its patch lives in library-en.json under 'own'.
    Every knob is marked as inferred (≈) unless 'sourced' names it; 'notes' explain single knobs."""
    own = en['own']; patch = json.loads(json.dumps(own['patch'])); meta = {}
    for m in patch['modules']:
        for k in m['params']:
            key = f"{m['id']}.{k}"
            sourced = own.get('sourced', {}).get(key)
            entry = {'prov': 'source' if sourced else 'inferred'}
            note = sourced or own.get('notes', {}).get(key)
            if note: entry['note'] = note
            meta.setdefault(m['id'], {})[k] = entry
    patch['meta'] = {'library': en.get('id'), 'params': meta}
    return patch

out = []
for src in SRC['patches']:
    en = EN.get(src['id'])
    if not en: sys.exit(f'missing English texts for {src["id"]}')
    playable = src['status'] in ('complete', 'partial') and 'modules' in src
    own = en.get('own')
    entry = {
        'id': src['id'], 'title': en['title'], 'artist': en['artist'], 'year': src['year'],
        'status': own['status'] if own else src['status'], 'difficulty': src.get('difficulty'), 'category': src.get('category', []),
        'goals': en.get('goals', []), 'history': en.get('history', []), 'gear': en.get('gear', []),
        'facts': en.get('facts', []), 'inApp': en.get('inApp', []),
        'tutorial': en['tutorial'] if own else [{'text': t, 'focus': s['focus']} for t, s in zip(en.get('tutorial', []), src.get('tutorialSteps', []))],
        'sources': [{'title': s['title'], 'url': s['url']} for s in src.get('sources', [])] + en.get('sources', []),
        'references': [{'title': (en.get('references') or [r['title'] for r in src.get('referencePatches', [])])[i] if i < len(en.get('references') or []) else r['title'],
                        'platform': r['platform'], 'url': r['url']} for i, r in enumerate(src.get('referencePatches', []))],
        'guide': GUIDES.get(src['id']),
        'patch': own_patch({**en, 'id': src['id']}) if own else convert(src, en) if playable else None
    }
    out.append(entry)

order = ['i-feel-love-bass', 'stranger-things-arp', 'on-the-run-sequence', 'oxygene-iv-lead', 'blade-runner-brass', 'dx7-epiano-1']  # learning path
out.sort(key=lambda e: order.index(e['id']) if e['id'] in order else 99)
js = ('// GENERATED by tools/convert-library.py from Idea/patches.json and tools/library-en.json. Do not edit by hand.\n'
      f'export const LIBRARY = {json.dumps(out, ensure_ascii=False, indent=1)};\n')
(ROOT / 'js' / 'library.js').write_text(js)
print(f"wrote js/library.js: {len(out)} entries, {sum(1 for e in out if e['patch'])} playable")
