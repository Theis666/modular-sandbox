# Polyphony as a Keyboard option, off by default

The Keyboard has a **Voices** knob (1–8, default 1). At 1 everything behaves as before (monophonic, last-note priority). Above 1, every module of a poly type (VCO, Noise, VCF, VCA, ADSR, LFO, Mixer) that can be reached by cables from that Keyboard gets hidden copies, one per extra voice, wired exactly like the visible module (`js/voices.js`). Each held key gets a free voice; when all are busy, the oldest note is taken over. Effects (Delay, Chorus, Reverb) and the Output are never copied: all voices meet there through one trim of 1/√voices, so chords do not get much louder than single notes. This supersedes ADR 0002.

The rack still shows one copy of each module. Its knobs turn all copies; its jacks, scope, lights and envelope display show voice 1. To keep the "one cable carries one signal" idea honest, poly cables are drawn thicker and copied modules show a "×n" badge, and the Voices info text explains the copying.

## Considered Options

- Stay monophonic (ADR 0002): rejected, because Blade Runner (CS-80, 8 voices) and the DX7 E-Piano are chord sounds; the library had to say "plays one note at a time".
- Paraphonic (several VCOs, one shared filter and VCA): rejected. Simpler, but a new note restarts the envelope for every note, which sounds wrong for brass and e-piano and teaches a special case.
- Polyphony always on, with poly cables as a separate cable kind (like VCV Rack): rejected for now. Beginners would meet multi-channel cables in the first guide.

## Consequences

- Basics guides stay monophonic; polyphony appears as its own step in Blade Runner (end) and DX7 E-Piano (start). The library sets the source's voice count (Blade Runner: 8).
- CPU grows with voices × poly modules (Blade Runner at 8 voices: 70 hidden copies). Fine in desktop Chrome; not yet measured on a real iPhone.
- Hidden copies are rebuilt after every cable or module change and after loading a patch. That can cut a held note, which is acceptable while patching.
- Not covered yet, open for extension: unison (several voices per key, detuned), voice stealing options, poly modulation from a Sequencer or Arp, per-voice display, a CPU guard that lowers voices on slow devices.
