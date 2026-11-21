---
status: superseded by ADR-0008
---

# Monophonic only

The synth plays one note at a time (last-note priority). Polyphony would require cloning the whole patch per voice, which breaks the "one cable carries one signal" model the app exists to teach, and costs CPU on older iPhones.
