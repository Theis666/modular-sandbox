# Spec: Modular Synth Sandbox (v1)

A standalone iPhone web app (PWA) in which an absolute beginner patches Eurorack-style modules, plays them, and learns what each part does. All UI text is English. Terms follow [GLOSSARY.md](GLOSSARY.md).

## Goals
- Make the modular idea tangible: every sound is modules + cables, and even the keyboard is "just a module".
- Playable immediately, explorable without a manual.
- Works offline from the home screen.

## Non-goals (v1)
MIDI, Vital export. (Polyphony, effects and the Scope module were added later.) See [ROADMAP.md](ROADMAP.md).

## Platform
- PWA: manifest, service worker (offline cache), `apple-mobile-web-app-capable`, portrait and landscape.
- Plain HTML/CSS/JS, no build step ([ADR 0003](docs/adr/0003-pwa-plain-js-self-hosted.md)).
- Audio via Web Audio API. First launch shows "Tap to start audio" (iOS requires a gesture). Audio session set to `playback` where supported so the mute switch does not silence the app.

## Rack
- Eurorack look: brushed aluminium panels, HP widths, knobs, 3.5 mm jacks, coloured cables drawn as sagging curves above the modules.
- Portrait; modules flow in rows, vertical scroll. Pinch to zoom out for an overview.
- **Moving and removing modules**: drag a module by its name bar to another place; a yellow line shows where it lands. While a module is dragged, a red bin covers the top bar: drop it there to remove the module (↶ brings it back). Tapping the name opens its menu: info, move back/forward, duplicate, remove. "+" adds a module. The name bar does not scroll the rack, so the drag starts at once (no long-press).
- Zoom button toggles 100% / 50% overview; pinch zooms freely (0.4×–2×). Zooming out reflows the rack so more modules fit per row.
- Cable button cycles cables solid / see-through / hidden, to reach knobs underneath. Jacks and knobs always win over a cable lying on top.
- Keyboard is pinned to the bottom of the screen with octave −/+. The number of octaves fits the screen so white keys stay about 44 px wide (iPhone portrait: 1, landscape: 2, iPad: 3); a button beside the octave label switches between 1, 2, 3 and automatic, and is remembered.
- **Landscape on phones**: modules are sized to the screen height so one row of modules fits without scrolling (the whole Basic Synth is visible at once); the guide becomes a side column instead of taking height; the keyboard is flatter with its controls beside the keys; side safe areas (notch) are respected. The installed app may rotate (manifest orientation "any").

## Patching
- Drag from a jack to another jack, **or** tap a jack then tap a target jack.
- While a cable is pending, all compatible jacks glow; incompatible ones dim.
- A jack picked by tapping is dropped again by a short tap anywhere else on the rack (also on a knob or a module name), by tapping the same jack, or with the Escape key. Scrolling or turning a knob keeps it, so you can scroll to the target jack.
- A cable always runs output → input; starting from an input works too and is reversed.
- An input accepts one cable; an output can feed many. Plugging into an occupied input replaces the old cable.
- Tap a cable → popover with live **Scope** and "Remove".
- Cables pulse with the level of their signal.
- **Cable colour shows what a cable carries**: red = Audio, blue = CV, green = Pitch, yellow = Gate. VCO and Noise output Audio, ADSR and LFO output CV, Keyboard and Sequencer output Pitch and Gate. Processing modules (VCF, VCA, Mixer, Delay, Chorus, Reverb) pass on the type of what arrives at their input, so a VCA fed by an LFO outputs CV. Cables of the same type get slightly different shades. The legend appears in the cable sheet and in Info Mode on a cable.
- **Touch targets**: knobs have an invisible ring (about 44 pt on iPhone); a tap up to 14 px beside a jack's edge snaps to that jack, preferring one that completes a pending cable; small buttons ("i", wave, Run) have enlarged invisible hit areas. A touch that turns into a scroll never leaves a half-made cable.
- Jack kinds ([ADR 0004](docs/adr/0004-gate-is-an-event.md)): *signal* (audio/CV/pitch) and *gate*.

## Modules (24 modules)
Controls after "More:" sit on the module's second page: the Main / More tabs under the module name switch pages (ADR 0010). The first three times More is opened, a message says what the page holds. Switching pages changes nothing in the sound. New ADSR and VCA modules start exponential; patches made before a control existed load with its `legacy` value, so they sound unchanged.

| Module | Inputs | Outputs | Controls |
|---|---|---|---|
| Keyboard | – | Pitch, Gate, Vel, Mod | Glide, Voices (1–8, ADR 0008); More: Unison (1–4), Steal (Oldest/Lowest/Highest/None), Spread; voice lights |
| Sequencer | Clock, Transp | Pitch, Gate, Acc | 8 step pitches, 8 step on/off buttons (rests), Tempo, Length, Run; More: Steps (1–8), Direction (→ ← ↔ ?), Slide and Accent per step |
| Arp | Clock | Pitch, Gate | Mode (↑ ↓ ↑↓ ↓↑ ? ~), Octaves (1–3), Tempo, Speed, Start, Hold; More: Length |
| Clock | – | Clock, Beat | Tempo, Pulses (1/8, 1/16), Swing, Run |
| VCO | Pitch, FM, Lin, PWM, Sync | Out, Sub | Wave, Octave, Fine, FM Amt; More: Ratio, Width, Lin FM, Drift; live wave display. With AudioWorklet: band-limited (PolyBLEP), else the built-in oscillator (no Width/Lin/Sync/Sub/Drift) |
| Noise | – | Out | Level, Colour (white, pink, brown) |
| DX | Pitch, Gate, Vel | Out | Ratio and Level of three modulator→carrier pairs, Detune, Brightness Decay, Decay, Release (needs AudioWorklet) |
| VCF | In, Cutoff, Key, Cut 2 | Out | Type (LP, LP24, Lad, HP, BP, N), Cutoff, Reso, CV Amt; More: Key Trk, Drive, Keep Lvl (Lad), Amt 2; live filter curve |
| Folder | In, CV | Out | Fold, Symmetry |
| Ring | A, B | Out | – (A × B) |
| VCA | In, CV | Out | Level, CV Amt; More: Response (Exp/Lin). Negative CV keeps it closed |
| ADSR | Gate | Out | A, D, S, R; More: Curve (Exp/Lin); live envelope display |
| LFO | Reset | Out | Wave (6 shapes), Rate, Depth; More: Fade; live movement display |
| S&H | In, Gate | Out | Source (Random/In) |
| Slew | In | Out | Rise, Fall |
| Quantizer | In | Out | Scale (Chrom, Major, Minor, Penta, Blues), Root |
| Atten | In 1, In 2 | Out 1 (×2), Out 2 (×2) | Amt 1, Amt 2 (−1…+1) |
| Mixer | In 1–3 | Out | Level 1–3 (−1…+1), Out |
| Trigger | In | Out (Gate) | Threshold |
| Delay | In | Out (dry + echoes) | Time, Feedback, Mix; More: Sync (Free, 1/4, 1/8., 1/8, 1/16), BPM, Tone |
| Chorus | In | Out (stereo) | Rate, Depth, Mix; More: Mode (I, II, I+II presets), Hi Cut |
| Reverb | In | Out (stereo) | Size, Tone, Mix, Type (Room, Plate, Spring); More: Pre-delay; Size changes crossfade |
| Scope | A, B | – | Time, Scale, Freeze |
| Output | In | – | Volume, Pan, Rec; level meter |

Effects (Delay, Chorus, Reverb) pass the dry signal through and add their effect on top, scaled by Mix. Chorus and Reverb are the only stereo sources; everything else is mono and is heard equally on both sides.
| Arp | (the on-screen keys) | Pitch, Gate | Mode (↑ ↓ ↑↓ ↓↑ random), Tempo, Speed (1/8, 1/16, 1/32), Length, Start note, Hold; a chord can be stored in the patch |

Pitch convention: 0 = C3, one unit = one octave. Monophonic by default, last-note priority. **Polyphony** ([ADR 0008](docs/adr/0008-polyphony-as-a-keyboard-option.md)): the Keyboard's Voices knob (1–8) copies every VCO, Noise, VCF, VCA, ADSR, LFO and Mixer behind it once per voice (hidden copies, same knobs). Effects and Output stay single; voices are summed with a 1/√n trim. When all voices are busy the oldest note is taken over. Poly cables are drawn thicker, copied modules show a "×n" badge. **VCO Ratio** ([ADR 0009](docs/adr/0009-fm-with-ratio-and-four-operators.md)): multiplies the frequency (0.5–16×), for FM ratios like a DX7 operator.

## Learning aids
- **First-start introduction**: after the first "Tap to start audio", four hints with a yellow spotlight on the real control: turning a knob (double-tap resets), moving and removing modules (drag the name, the bin), Info Mode (?), and Guide. Skip or Next; shown once, replayable from ☰ → "Show the introduction again".
- **No unexplained abbreviations.** Every abbreviation (VCO, CV, ms, BPM, …) is defined once in `js/abbr.js`. Info sheets list all abbreviations they contain under "Abbreviations"; the guide panel shows a one-line legend for the current step; every abbreviation is underlined and can be tapped for its meaning; the module list shows full names (e.g. "VCF Voltage-Controlled Filter"); control titles in Info Mode use the full name ("Resonance", not "Reso"). `node tools/scan-abbreviations.mjs` fails if any text uses an abbreviation that has no definition.
- **Waveforms are drawn, not named.** The Wave buttons on VCO and LFO show a small drawing of the current shape (sine, triangle, saw, square); tapping switches it and briefly shows its name.
- **Info Mode** ("?" toggle): tapping a module, knob or jack shows 2–3 sentences plus a "Try this:" hint instead of acting.
- **"i" button** per module: full info sheet for that module.
- **Example Patches** (≈6): Basic Synth (default start), Vibrato, Wah, Wind, Sequenced Bass, Drum Kit (Clock, two Sequencers, kick, snare, hi-hat).
- **Guided Builds** ([ADR 0006](docs/adr/0006-guided-builds-on-top-of-the-sandbox.md)): "Guide" in the top bar (also in ☰) lists target patches in three groups: *Basics* (Basic Synth, Wah, Vibrato, Wind, Sequenced Bass, Seeing sound, Random melodies, West coast tones, Acid line, Expressive playing), *Drums* (Kick drum, Snare drum, Hi-hats, Drum machine: drum sound design from VCOs, Noise and envelopes with zero Sustain, then programming a beat on the Drum Kit) and *Classic sounds* (I Feel Love 1977, Stranger Things 2016, On the Run 1973, Oxygène IV 1976, Blade Runner 1982, DX7 E-Piano 1983). Classic-sound guides open and close with the story of the sound (device, how it was made, how to rebuild it with today's plugins) and say plainly that they are simplified rebuilds, not copies. A guide clears the rack (after asking) or starts from an Example Patch, then shows one Step at a time in a panel above the keys: what to do, and *why*.
  - A pulsing frame marks where to tap: "+", then the right entry in the module list, the source jack, the target jack (the other end is outlined dashed), the knob to turn, the Main/More tab, or the keys. It scrolls the rack or list to bring the target into view. The frame sits inside the area that scrolls (rack or sheet), so it moves with its target. Only the rack is dimmed around it; the guide text, top bar and keys stay bright.
  - Step kinds: add a module, connect a cable, set a control to a goal (e.g. Cutoff below 600 Hz), play notes, or read and tap Next.
  - A step completes as soon as its goal is true, however it was reached; a green check shows, then the next step follows.
  - **Before/after**: when a step that turns a knob or switches a button (e.g. filter type) is done, the guide does not move on by itself. It shows "Hear the difference" with *Before · old value* and *After · new value*; tapping them sets the control to that value for listening (no undo step). *Next* keeps the new value and continues. On/off switches (Run) skip this, and so does any step whose module is not yet in the sound, that is, no chain of cables leads from it to the Output (a VCO set up before its first cable, a Scope): there would be nothing to hear, so the step ticks off and the guide moves on.
  - "Do it for me" performs the current step. The panel has window buttons: – makes it small, ✕ closes the guide (the rack stays, progress is saved).
  - The text scrolls inside the panel; Next / Do it for me sit below it and never cover it. Text that does not fit fades out at the bottom.
  - The panel folds to one line (check, step title, "5/18", Show) as soon as a touch in the rack ends, so the rack gets the room while you patch; it opens again at the next step. – folds it until you tap Show. While guiding there is spare room below the rack, so folding never shifts what is under your finger.
  - Last screen: "You built …", with "Another guide" and "Done".

## Classic sounds library ([ADR 0007](docs/adr/0007-classic-sounds-library-from-idea-patches.md))
- ☰ → "Classic sounds": 10 entries from `Idea/patches.json`, in the suggested learning order. 4 are playable patches from the source data (I Feel Love, Stranger Things, Oxygène IV, Blade Runner), DX7 links to its simplified guided build, 4 are story cards with external links.
- **Own recreations**: a sound the source only describes can get our own patch, kept in `tools/library-en.json` under `own` (status `recreation`). It is researched first; only values a source gives are unmarked, every other knob shows "≈", and "In this app" says what is a guess. So far: On the Run (Pink Floyd, 1973), with a tour and a guided build.
- A card shows artist and year, difficulty, what you learn, the story, original gear, "In this app" (what is simplified), external patches and sources as links, and an abbreviation legend. Buttons: "Load the patch", "Build it step by step" (all six sound entries have a Guided Build) and "Take the tour".
- **Tour**: loads the finished patch and walks through the source's tutorial steps in the guide panel (Back / Next / ✕). The modules each step talks about light up with a yellow ring; the others are dimmed. Nothing has to be done to advance; the learner can play and turn knobs at any time.
- Knobs whose value the source does not give are marked "≈". Info Mode on a knob says whether the value is from the source or a starting value, with the source's note and the original plugin value where there is one. The marks survive saving and undo.
- Acceptance checks (from IMPLEMENTATION.md, adapted): I Feel Love at 125 BPM plays only steps 1, 3, 5, 7 (in the library patch and at the end of its guide) and the 120 ms delay fills the gaps; Stranger Things plays a held C major 7 Down-Up starting on G; every playable patch makes a sound; On the Run plays E2–G2–A2–G2–D3–C3–D3–E3 as sixteenth notes at 165 BPM (91 ms per step).

## Undo
- ↶ in the top bar (Cmd/Ctrl+Z on a computer) steps back through the last 60 changes: added/removed modules, cables, knob moves, loading a patch, clearing the rack. One knob drag is one step.
- Loading a patch keeps its module ids, so undo and a running guide keep pointing at the same modules.

## Storage & export
- Autosave of the current patch; named local patch list.
- Export/import patch as `.json` via the iOS share sheet / file picker. Format is versioned ([ADR 0005](docs/adr/0005-own-patch-format-not-vital.md)).
- Recording: Rec on Output → stereo WAV (16-bit, device sample rate), max 5 min, then share sheet. It records the final mix after the master limiter and soft clipper, so files never clip.
- Master bus: compressor/limiter, then a soft clipper that is neutral below 0.8 and never exceeds 1.0.

## Acceptance
- Fresh install plays a note on first key press after "Tap to start".
- Every module has Info Mode text for itself, each control and each jack.
- Each Example Patch loads and sounds as described.
- Each Guided Build can be completed by tapping only where the spotlight points, and ends with a patch that sounds as described.
- A patch exported and re-imported is identical.
- Works offline after first load; installs to home screen and opens full screen.

## Scope module (ROADMAP M4-7)
- Two inputs (A, B), no outputs: it only looks. Traces take the colour of their cable; B is a lighter shade. Both share one scale (Auto picks the smallest of ±0.1/0.2/0.5/1/1.5/2/5/10 that fits).
- Time 5/20/100 ms: still picture, triggered on A (or B if A is empty) rising through zero; each trace shows its frequency in Hz and the nearest note. Time 1 s/4 s: rolls right to left, drawing each frame's min/max (sound appears as a band following its envelope); traces show their current value.
- Freeze holds the picture (not saved with the patch). Basics guide "Seeing sound" (23 steps) teaches it on the Basic Synth.

## Learning aids added 2026-11-20
- **Live displays (L1)** on VCO, LFO, VCF, Keyboard (voice lights) and Output (level meter), besides ADSR and Scope.
- **Chapters and progress (L4)**: long guides are split into chapters with a pause between them; progress is saved per guide (Guide list: "Continue at step …", or Start over). Finished guides tick off concepts; the Guide list shows all concepts (53) with a short explanation.
- **Guide list**: guides in progress first ("Continue"), then folding groups (Basics, Drums, Classic sounds, Concepts, Train your ears) that remember whether they are open. Inside a group the easiest come first; each guide shows its level: ●○○ beginner, ●●○ some experience, ●●● advanced (`level` in js/guides.js).
- **Ear challenges (L5)**: ☰ or Guide list. Six challenges load a small patch and hide a target setting; ▶ Target plays it (knobs and displays stay unchanged), ▶ Mine plays yours, Check measures the distance in knob travel (match at ≤ 6 % for every knob), a hint names the knob furthest off after the second try, Show answer after two tries.
- **Mod strip and MIDI**: a strip left of the keys (Keyboard Mod output, stays where left, double-tap resets); ☰ "Connect a MIDI keyboard…" where Web MIDI exists (notes, velocity, mod wheel).

## Engine and tests added 2026-11-20
- **AudioWorklet** (`js/worklet.js`, ADR 0010): VCO, ladder filter, Trigger, S&H, Slew, DX. Loaded before the first module is built; without it the modules fall back to built-in nodes (DX stays silent). Worklet VCO levels and start phases match the built-in oscillator, so old patches sound unchanged.
- **CPU guard (M0-3)**: with Voices > 1 the patch is rendered offline for 0.5 s; above 50 % of real time a hint appears, above 85 % Voices are halved.
- **Sound regression tests (M0-2)**: `tools/render-tests.js` renders every Example Patch and Classic sound offline and compares peak, RMS and spectral centroid with `tools/render-baseline.json` (tolerance 15–20 %).
- `?mute` in the URL silences the speaker while everything else runs (for testing).

## Windows and messages
- Every panel can be closed like a window: sheets have ✕ at the top right (tapping beside the sheet also closes it), the guide, tour and ear challenge panels have ✕ (and – to make the guide small), the introduction has ✕. Messages at the bottom disappear on a tap; one that stays (Info Mode) shows ✕.
- **Cables around displays**: a cable first hangs the usual way. If it would cross a display (wave, filter curve, envelope, scope, meter …), the app tries other shapes: a tighter or looser sag, or a detour through the gaps between modules or rows. It takes the one that covers no display, preferring shapes that also stay off knobs, inside the rack and short. A cable that only grazes a display keeps its normal shape. While a module is dragged or the rack zooms, cables hang plainly and are routed again when the movement pauses (about 0.2 s).
- **Cables over controls**: touches go through cables to the jack or knob underneath; a touch that starts on a cable over a knob or jack never scrolls the rack, so the knob turns. While a knob turns, all cables fade to 15 %; while a module is dragged, to 45 %. The cable button (a patch cable between two plugs) switches solid → see-through (dashed icon) → hidden (crossed-out icon).
- **Knob targets**: the knob, an invisible ring around it, and its label all turn it (drag up/down). The knob and ring never scroll the rack; on the label a sideways swipe still scrolls.
- **Very short landscape** (height ≤ 400 px, e.g. inside another app's viewer): flatter top bar and keyboard (keys 48 px, octave controls in two short rows), modules sized down to 9 HP-px so one row fits the height without zooming out; the guide column is min(320 px, 38 % of the width) with smaller type. While guiding in landscape, messages appear over the rack, never over the guide panel or the top bar.
- The guide's highlight frame in the rack is part of the rack layer: it scrolls and zooms with the modules without lag.
- **Foldable keyboard**: ▾ at the right end of the keys folds the keyboard bar to a thin "▴ Keys" strip, so the rack gets the room (remembered on this device). A guide step that asks you to play points at ▴ Keys while the keys are folded.
- **No scrolling from controls**: a touch that starts on a knob, its label, a jack (or right beside one) or a module's name bar cancels the browser's scrolling in the touch-start handler, in addition to CSS touch-action, which some app viewers on the iPhone do not honour. Tapping the name opens the module menu on pointer-up.
- **Keys and zoom**: the page never pinch-zooms (body touch-action pan-x pan-y; iOS ignores user-scalable=no). Two fingers zoom the rack only while no key is held, so one finger on the keys plus one on the rack never zooms. Touches on the keys and the mod strip cancel the touch start: no long-press magnifier, no text selection by repeated taps (guide text is not selectable either), no double-tap zoom.
- **Inside another app's viewer** (the page runs in an iframe, e.g. the Artifact viewer): the host keeps clear of the notch and home bar, so the app drops its own safe-area padding (html.framed). Before, the viewer reported large insets and the app showed an empty band above the top bar and below the keys.
- **Battery and heat**: live displays redraw 30 times a second and only for modules on screen (IntersectionObserver); cable and LED brightness updates 15 times a second in 10 steps and is written only when the step changes; the guide checks its frame 20 times a second; the frame's pulse animates only the opacity of a glow layer. When the app goes to the background (other app, other tab, screen off) the audio context is suspended unless a recording runs, and resumes on return. Measured with the Stranger Things patch (13 modules, 17 cables): script time per frame 2.3 → 0.9 ms, cable/LED style writes about 1100 → 100 per second.
- **Sound that stops**: iOS interrupts web audio (calls, Siri, notification sounds, other apps playing, lock screen, new headphones) and allows it to start again only inside a touch. The app tries to resume when it comes back to the front, and again on every touch or key until the sound runs. If the sound is still stopped while the app is in front, a message says "The phone paused the sound. Tap anywhere to turn it back on."; it disappears once the sound runs.
