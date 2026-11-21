# Expert controls in a fold-out panel; exponential response for new ADSR and VCA

New controls from the module plan (ROADMAP M1–M4) that a beginner does not need sit in a fold-out row on the module: a small "⋯" button under the module's main knobs shows or hides them. The front of every module keeps only the beginner controls, so the iPhone view stays readable. Whether a module is folded out is stored per module in the patch.

New ADSR and VCA modules start with an exponential response (Curve and Response controls), which sounds like analog hardware: decays fall fast and then slowly. Modules loaded from older patches keep the linear response, so existing patches and saved work sound unchanged; guides are re-run after the change.

Phase 3 of the plan (PWM, hard sync, linear FM, ladder filter, spring reverb) is built with AudioWorklet, measured with the CPU guard (M0-3), and the built-in node versions stay as a fallback where AudioWorklet is missing. This needs no build step (ADR 0003): the worklet is a plain JS file, and the Artifact bundle loads it from a Blob URL.

## Considered Options

- Expert controls in the module menu (a list of sliders): rejected, because the controls would not look or work like the rest of the panel.
- A global Beginner/Advanced switch: rejected, because it hides controls on every module at once, even where the learner just wants one.
- Linear by default everywhere: rejected; exponential is how real envelopes and amplifiers behave, and old patches are protected by keeping their stored value.
- Vital export stays under Later (decided 2026-11-20).

**Amendment (2026-11-21):** The "⋯" button was hard to understand: the knobs changed, but it was not clear what had been switched. It is replaced by two tabs under the module name, **Main** and **More**, with the active one underlined in the module's colour. The first three times More is opened, a message says what the page holds. The decision itself (two pages, stored per module as `ui.expanded`) is unchanged.
