# Classic sounds library: converted from Idea/patches.json, not a new engine

`Idea/patches.json` (with `Idea/IMPLEMENTATION.md`) describes famous synth patches in its own schema and suggests building a new TypeScript, polyphonic app around it. We keep the existing app and instead convert the file: `tools/convert-library.py` reads it (never changes it), adds English texts from `tools/library-en.json`, and writes `js/library.js` in this app's own patch format (ADR 0005). The engine gained only what the patches need and that fits the modular model: LP24 and key tracking on the VCF, rest steps on the Sequencer, random LFO shapes, longer envelopes, and an Arp module.

## Considered Options

- Follow IMPLEMENTATION.md literally (TypeScript, data-driven engine, polyphony, 6-operator FM): rejected for now. It conflicts with ADR 0002 (monophonic) and ADR 0003 (no build step) and would replace a working, tested app.
- Load `patches.json` at runtime: rejected. The app would depend on a file outside `js/`, the Artifact bundle could not include it, and German texts would reach an English UI.

## Consequences

- Values keep their provenance: knobs whose value the source does not give show "≈", and Info Mode says where each value comes from (including original plugin values).
- Where the source wires two cables into one input, the converter inserts a Mixer, because every input here takes one cable. Envelope amounts become the Mixer levels.
- Polyphony was added later as a Keyboard option (ADR 0008) and FM got a VCO Ratio knob with a 4-operator DX7 guide (ADR 0009); a full 6-operator engine is still not built. The library says plainly what each patch simplifies ("In this app").
- Stereo panning from the source is ignored (the app plays in the middle); output level is lowered when several oscillators are mixed, marked as inferred.
- After editing `Idea/patches.json` or `tools/library-en.json`, run `python3 tools/convert-library.py`.
