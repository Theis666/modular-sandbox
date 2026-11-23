# Roadmap

## Learning experience and UI improvements

Proposed after the first full build (2026-11-18), ordered by impact per effort within each group. Status as of 2026-11-18.

### Learning experience

| # | Idea | Why it helps | Status |
|---|---|---|---|
| L1 | **Signals visible on the modules**: the ADSR draws its envelope live, with a dot showing the current stage; VCO/LFO show their wave live; the VCF shows its filter curve | Beginners understand "Attack, Decay, Sustain, Release" in seconds when they see it move; today signals are only visible when you tap a cable | **Done** (2026-11-20): ADSR envelope, VCO wave, LFO movement, VCF filter curve |
| L2 | **Cable colour by signal type** (red Audio, blue CV, green Pitch, yellow Gate) | Teaches the core modular idea in passing: one kind of cable *sounds*, another *controls* | **Done** |
| L3 | **Before/after button in guide steps** ("Hear the difference" toggles the change on and off) | Subtle changes (chorus on a bass, a small resonance boost) are otherwise easy to miss | **Done** (2026-11-19): every knob and switch-button step; on/off switches excluded |
| L4 | **Chapters and saved progress for long guides** (DX7 has 59 steps), plus an overview of concepts learned (Gate, CV, Modulation, FM …) | Long guides are tiring in one go; a visible list of concepts shows progress | **Done** (2026-11-20): chapters with a pause between them, progress saved per guide (Continue / Start over), 32 concepts ticked off by finished guides |
| L5 | **Ear challenges**: the app plays a target sound, you patch it, the app says how close you are | Checks understanding without anyone dictating the steps | **Done** (2026-11-20): 6 challenges (cutoff, wave, octave, envelope shape, squelch, wobble); closeness measured on the knobs, hint after the second try |

### UI

| # | Idea | Why it helps | Status |
|---|---|---|---|
| U1 | **Bigger touch targets** without changing the Eurorack look: invisible ring around knobs (~44 pt), taps up to 14 px beside a jack snap to it, enlarged hit areas on small buttons | On iPhone knobs were ~35 px and jacks ~23 px, below Apple's 44 pt guideline | **Done** |
| U2 | **Guide panel folds while patching** to one line and opens again at the next step | With explanation and legend the panel took 210–270 px; the rack had about a third of the screen | **Done** |
| U3 | **Undo** (↶, Cmd/Ctrl+Z), 60 steps, one knob drag = one step | Removes the fear of experimenting; a replaced cable or a cleared rack is no longer final | **Done** |
| U4 | **First-start introduction** (about 30 seconds, 4 hints): double-tap resets a knob, drag a module name to move it (bin to remove), ? for Info Mode, Guide | These gestures are not discoverable on their own | **Done** (2026-11-19); replay from ☰ |
| U5 | **Keyboard and landscape**: option for one octave with wider keys; landscape layout with more keys and more rack | Two octaves on an iPhone make narrow keys | **Done** (2026-11-19) |

### From Idea/ (2026-11-19)

| # | Idea | Status |
|---|---|---|
| I1 | Convert `Idea/patches.json` into a Classic sounds library with cards, sources and "≈" marks | **Done** |
| I2 | Engine: LP24, key tracking, sequencer rests, random LFO, Arp, longer envelopes | **Done** |
| I3 | Guided builds for Oxygène IV, Stranger Things, Blade Runner; I Feel Love guide updated to the new data (rests, 125 BPM, 120 ms delay) | **Done** |
| I4 | "Tour" through a finished library patch, step by step with the source's tutorial steps and the focus modules highlighted | **Done** |
| I5 | Polyphony for Blade Runner and DX7: Voices knob on the Keyboard, off by default ([ADR 0008](docs/adr/0008-polyphony-as-a-keyboard-option.md)) | **Done** (2026-11-19), open for extension: unison, CPU guard, poly Sequencer/Arp |
| I6 | FM closer to E.PIANO 1: VCO Ratio knob and a 4-operator DX7 guide ([ADR 0009](docs/adr/0009-fm-with-ratio-and-four-operators.md)) | **Done** (2026-11-19), open for extension: third pair, linear FM, 6-operator module |
| I7 | Filter drive, unison, velocity, tempo-synced delay as a knob (now computed once from the tempo) | **Done** (2026-11-20) via the module plan (M1-3, M2-1, M2-3, M1-8) |

## Module improvements: function and sound (plan, 2026-11-19)

**Status: implemented (2026-11-20).** Open from this plan: a pitch-bend mode for the mod strip (16-step sequences done 2026-11-23). The Basics guides for the new modules are done (2026-11-20): Random melodies (Clock, S&H, Atten, Quantizer, Slew, Trigger), West coast tones (Folder, Ring), Acid line (ladder filter, slides, accents, drive, swing), Expressive playing (velocity, mod strip, PWM, chords, unison). Drum guides added (2026-11-21): Kick drum (pitch envelope, drive), Snare drum (tone + noise layers, plate reverb), Hi-hats (high-passed noise, ring-modulated squares, Clock), Drum machine (patterns, swing, LFO and reverb on the Drum Kit Example Patch). Decisions taken ([ADR 0010](docs/adr/0010-expert-controls-and-analog-defaults.md)): expert controls in a fold-out panel per module; new ADSR and VCA exponential by default (old patches unchanged); Phase 3 with AudioWorklet and CPU guard; Vital export stays under Later.

Based on a review of every module in `js/modules.js`. Ordered in four phases: each phase is useful on its own, and later phases build on earlier ones. Effort: S = hours, M = a day, L = several days.

### Principles

- **Beginner panel first.** A module's front keeps the knobs a beginner needs. New expert controls go behind the module menu (tap the module name) or into an "expanded" panel, never crowding the iPhone view. (Open decision, see below.)
- **Old patches keep sounding the same.** Every new control has a default that reproduces today's sound; the patch format only gains optional fields (ADR 0005).
- **Every new knob is explained**: info text, abbreviations in `js/abbr.js`, glossary entry where it is a new idea, and the guides that rely on the old behaviour are re-run with `tools/guide-walkthrough.js`.
- **Measure, then decide.** Sound changes are checked with offline renders (see M0-2) and CPU on a real iPhone before they become defaults.

### Phase 0: groundwork and fixes

| # | Module | Change | Why | Effort |
|---|---|---|---|---|
| M0-1 | Noise | Start each Noise (and each poly copy) at a random point of the noise buffer | All copies currently play the same buffer from the same moment, so with Voices > 1 the noise of all voices is identical and adds up instead of blending | S · **Done** (2026-11-20) |
| M0-2 | (tools) | Offline render tests: render each library patch and guide result with an `OfflineAudioContext`, store level and spectrum, compare after changes | Catches "the patch suddenly sounds different" before users do; today only the walkthrough checks that guides finish | M · **Done** (2026-11-20) |
| M0-3 | (all) | CPU guard: measure audio load (render time per block) and warn or lower Voices on slow devices | Blade Runner runs 70 hidden copies at 8 voices; not yet measured on an iPhone | M · **Done** (2026-11-20) |

### Phase 1: quick wins with plain Web Audio (no new technology)

| # | Module | Change | Why | Effort |
|---|---|---|---|---|
| M1-1 | ADSR | **Curve** knob: linear ↔ exponential segments (exponential by default for new modules, linear for old patches) | Analog envelopes fall fast first and then slowly, like a struck string. Plucks, basses and the DX7 tine sound more natural; today's straight lines make decays sound "slow, then cut off" | S · **Done** (2026-11-20) |
| M1-2 | VCA | Ignore negative CV (an LFO below zero no longer flips the signal) and add a **Lin/Exp** response switch | A bipolar LFO into CV currently turns the sound upside down instead of closing the VCA, which is not what a beginner expects; exponential response sounds like real amplifiers | S · **Done** (2026-11-20) |
| M1-3 | VCF | **Drive** knob (soft saturation before the filter) and a **second Cutoff input** with its own amount | Drive gives warmth and growl (Stranger Things, I Feel Love); the second CV input saves the extra Mixer the Blade Runner guide needs for two envelopes | S–M · **Done** (2026-11-20) |
| M1-4 | VCF | **Notch** mode and resonance gain compensation (less volume drop at high resonance) | A fourth classic filter type; high resonance currently makes the sound much quieter | S · **Done**: Notch. Level make-up moved to the ladder filter (Keep Lvl), because the biquad filter does not lose level with resonance (2026-11-20) |
| M1-5 | Mixer | Levels from −1 to +1 (attenuverter: negative inverts) and a master **Out** level | Lets the Mixer subtract and invert CV ("filter closes when the LFO rises") and tame loud sums without the Output knob | S · **Done** (2026-11-20) |
| M1-6 | Noise | **Colour** switch: white, pink, brown | Pink and brown noise are softer and closer to wind, sea and snare; today only harsh white noise | S · **Done** (2026-11-20) |
| M1-7 | LFO | **Fade** knob (vibrato fades in after the key press) and a **Reset** gate input (key sync); with Voices > 1, an LFO with a Reset cable becomes per-voice | Delayed vibrato is how singers and the Oxygène lead sound; key sync makes every note start the same way | M · **Done** (2026-11-20) |
| M1-8 | Delay | **Sync** to a tempo (1/4, 1/8, dotted, 1/16) and a **Tone** filter in the feedback | Closes I7: rhythmic echoes without arithmetic; darker repeats sound like tape or analog delay instead of a perfect copy | M · **Done** (2026-11-20) |
| M1-9 | Reverb | Keep the room when Size changes (crossfade to the new impulse response instead of a gap), add **Pre-delay** | Turning Size today cuts the tail for a moment; pre-delay keeps the dry note clear in big halls (Blade Runner) | M · **Done** (2026-11-20) |
| M1-10 | Chorus | **Mode** switch: I / II / I+II (different depths and rates, like classic ensemble choruses) and a high cut on the wet copies | Fewer knobs to find a good chorus; the wet copies currently carry every high frequency, which sounds thin on FM sounds | S · **Done** (2026-11-20) |
| M1-11 | Arp | **Octaves** knob (1–3) and a Random-walk mode | Spreading the chord over several octaves is the most-used arpeggiator setting; today the pattern stays within the held keys | S · **Done** (2026-11-20) |
| M1-12 | Output | **Level meter** (green/yellow/red) and a **Pan** knob | Shows when the limiter is working hard; pan lets library patches use the source's stereo placement (now ignored) | S · **Done** (2026-11-20) |

### Phase 2: playing and timing

| # | Module | Change | Why | Effort |
|---|---|---|---|---|
| M2-1 | Keyboard | **Velocity**: where you touch a key (front = loud, back = soft) becomes a Velocity output (CV) | The DX7 e-piano and the CS-80 brass react to touch; patch Velocity into a VCA or VCF CV to hear it | M · **Done** (2026-11-20) |
| M2-2 | Keyboard | **Mod strip** beside the keys: a touch ribbon with its own CV output (and an optional pitch-bend mode) | The Blade Runner sound is played with a ribbon; also a natural way to move cutoff live (Stranger Things intro) | M · **Done**, without a pitch-bend mode (open) (2026-11-20) |
| M2-3 | Keyboard | **Unison**: several detuned voices per key (uses the poly copies) | Fat leads and basses (Stranger Things uses 2 voices per note); builds on ADR 0008 | M · **Done** (2026-11-20) |
| M2-4 | (new) Clock | A **Clock** module (tempo, swing) whose output drives Sequencer, Arp and Delay sync | Today Sequencer and Arp each have their own tempo and can drift apart; one clock teaches what a master clock is | M · **Done**: Sequencer and Arp have Clock inputs; the Delay keeps its own BPM for Sync (2026-11-20) |
| M2-5 | Sequencer | **Length** 1–16 steps, **Slide** and **Accent** per step, a **Transpose** input (Pitch in shifts the sequence), Direction modes | Slide and accent are the sound of acid basslines; transpose lets you play the I Feel Love line from the keys, as on stage | L · **Done** (2026-11-20); 16 steps added on 2026-11-23, shown eight at a time (1–8 / 9–16) so the knobs stay big enough on the iPhone |
| M2-6 | Keyboard / Arp / Sequencer | Optional Web MIDI input (where the browser supports it) | Play with a real keyboard; already listed under Later | M · **Done** (2026-11-20) |

### Phase 3: sound engine (needs AudioWorklet, one new ADR)

Web Audio's built-in nodes limit some classic sounds. An AudioWorklet (plain JS, no build step, so ADR 0003 still holds; bundled into the Artifact as a Blob) gives sample-accurate processing.

| # | Module | Change | Why | Effort |
|---|---|---|---|---|
| M3-1 | VCO | **Pulse width** and PWM input (band-limited, e.g. PolyBLEP), **Sync** input (hard sync), **Sub** output | PWM is the classic string and pad movement (Juno, Oxygène-like pads); hard sync gives the tearing lead sound; none is possible with the built-in oscillator | L · **Done** (2026-11-20) |
| M3-2 | VCO | **Linear FM** (and through-zero) next to today's pitch-based FM | Today's FM bends the pitch in cents, so strong FM also shifts the pitch; linear FM keeps the note in tune and sounds much closer to the DX7 (ADR 0009) | M · **Done** (2026-11-20) |
| M3-3 | VCO | **Drift** knob: a tiny, slow random detune per oscillator and voice | The "alive" analog feel without patching an extra LFO (Stranger Things guide does that by hand today) | S (after M3-1) · **Done** (2026-11-20) |
| M3-4 | VCF | **Ladder** model (Moog-style, with feedback, self-oscillation and bass loss at high resonance) for LP24 | The biquad pair does not behave like a ladder filter: no self-oscillation, no typical "squelch"; the I Feel Love bass would profit most | L · **Done** as a new VCF type "Lad"; LP24 stays for older patches (2026-11-20) |
| M3-5 | Reverb | **Spring** and **Plate** types (spring: dispersion chirp from all-pass chains) | Oxygène uses a spring reverb; it is now imitated with a dark room (library "In this app") | M · **Done** (2026-11-20) |
| M3-6 | (engine) | Gate from any signal (an LFO or VCO as a clock or trigger) | Already in Later (ADR 0004); enables LFO-clocked sequencers and S&H on any signal | M · **Done** as the Trigger module (2026-11-20) |

### Phase 4: new modules

| # | Module | Why | Effort |
|---|---|---|---|
| M4-1 | **Attenuator / Multiple** | Scale, invert and copy signals; teaches that CV is "just a voltage" | S · **Done** (2026-11-20) |
| M4-2 | **Sample & Hold** (with Gate input) | Classic random melodies and filter steps; works on any signal after M3-6 | S · **Done** (2026-11-20) |
| M4-3 | **Slew** (lag) | Glide for any CV, smooth random, portamento for the Sequencer | S · **Done** (2026-11-20) |
| M4-4 | **Ring modulator** | Bell and robot sounds; a simple way to show what multiplying two signals does | S · **Done** (2026-11-20) |
| M4-5 | **Wavefolder** | West-coast timbres (Buchla style) as a contrast to filtering; a second way to make overtones | M · **Done** (2026-11-20) |
| M4-6 | **Quantizer** | Snaps random CV to a scale: random melodies that stay in key | M · **Done** (2026-11-20) |
| M4-7 | **Scope** module | A patchable oscilloscope (already in Later); complements L1 | **Done** (2026-11-19), with the Basics guide "Seeing sound" |
| M4-8 | 6-operator **FM** module (optional, "advanced") | Exact DX7 patches; see ADR 0009 for why it is not the default | L · **Done** as the DX module (algorithm 5, built-in envelopes) (2026-11-20) |

### Suggested order

1. **Phase 0** (M0-1 now, M0-2 before any sound change, M0-3 together with the first iPhone test).
2. **Phase 1**, in this order: M1-1 ADSR curve, M1-2 VCA, M1-3 VCF drive + second CV, M1-8 Delay sync, M1-11 Arp octaves, then the rest. The first three change the basic sound of almost every patch the most; the guides are re-run after each.
3. **Phase 2**: velocity and mod strip first (they make the Classic sounds playable as intended), then Clock and Sequencer.
4. **Phase 3** starts with an ADR for AudioWorklet and a CPU test on the iPhone; then VCO (M3-1, M3-2) before the ladder filter.
5. **Phase 4** module by module, each with a short Basics guide.

### Decisions (taken 2026-11-20, see ADR 0010)

- **Panel complexity**: expert controls behind the module menu, a per-module "expanded" view, or a global Beginner/Advanced switch?
- **Defaults for new patches** (e.g. ADSR exponential, VCA exponential): change the default sound for new modules, or keep linear everywhere for consistency with the current guides?
- **AudioWorklet** (Phase 3): accept the extra complexity and CPU risk on older iPhones, or stay with built-in nodes?

## Later

- Vital preset export, best-effort with a "what gets lost" warning (see ADR 0005)
- Polyphony extensions: unison, voice stealing (Oldest/Lowest/Highest/None), CPU guard and voice lights on the Keyboard are **done** (2026-11-20); open: poly Sequencer/Arp
- FM extensions: **done** (2026-11-20): linear FM on the VCO, the DX module with all six operators
- Scope module, more modules, gate-from-signal and MIDI input: now planned as M4-7, M4-1…M4-6, M3-6 and M2-6 above

## UI round (2026-11-21)
Done: modules move by drag and drop on their name bar, a bin at the top removes them; panels and sheets close with ✕ like windows, messages close on tap; Main / More tabs replace the ⋯ button; cables fade while a knob turns; a new cable-visibility icon (patch cable, not a wave); the Guide list folds into groups, sorted by difficulty with a level per guide; guide text scrolls above its buttons instead of under them; the guide's highlight frame scrolls with the rack and dims only the rack. Also fixed: in landscape the VCO's outputs were cut off at the bottom (jacks are now 2.3 HP wide, so three fit in a row).
Also done (2026-11-21): cables are routed around displays (see SPEC, Windows and messages).
Open: check the drag gesture, the bin and the routing speed on a real iPhone.

## iPhone feedback round (2026-11-21)
Fixed after testing in the Artifact viewer on an iPhone: the highlight frame no longer trails behind when zooming or scrolling (it lives in the rack layer); knobs under cables turn instead of scrolling the rack; knob labels also turn knobs; very short landscape screens get a flatter top bar and keyboard so modules fit without zooming out; messages no longer cover the guide panel or the + button; the before/after step says "Listen" when there are no keys to play.
Then (same day): knobs still scrolled the rack inside the viewer, so touches on knobs, labels, jacks and name bars now cancel scrolling in script; the keyboard bar folds away (▾ / ▴ Keys).
Then: no zoom while a key is held, no magnifier or text selection from the keys, no safe-area padding inside the viewer (it caused the empty band above the top bar).
Then: less work per frame against heat (see SPEC, Battery and heat).
Open: check on the iPhone again; if it still runs warm, the audio itself (AudioWorklet VCOs, reverb) is the next place to look.

## Guide audit (2026-11-21)
New `tools/check-guides.mjs` replays every guide on a model of the rack. Fixed: eight steps whose goal was already met before the step (it ticked itself off and the before/after comparison showed the same value twice): Random melodies (Slew Rise, LFO Rate), Kick (Decay, Cutoff), Snare (Decay, Cutoff, FM Amt), DX7 E-Piano (tine Decay); the Snare guide's third chapter pause never appeared (its start title matched no step); two cable steps that replaced a Keyboard cable without saying so. Content: the S&H range is one octave down to one up (the text said two), with the Atten at 0.3 the notes stay within about a major third; Moroder's "B" (German note name) is B flat, as the guide already plays. All 19 guides then ran through the walker in landscape without errors.

## Own recreations of story-only Classic sounds (2026-11-22)
Five library entries had only a story card, because `Idea/patches.json` gives no settings for them. They get our own patches, one at a time, after research:
- **On the Run** (Pink Floyd, 1973): **Done**. Clock at 165 BPM in 1/16 drives the Sequencer (tempo from Guesdon & Margotin via Wikipedia), notes E–G–A–G–D–C–D–E by ear (sources disagree), square wave into a resonant LP24 swept by a slow LFO, hi-hat from Noise × short envelope in the Ring modulator (as on the record), spring reverb. Patch, tour and a 55-step guide.
- **Thriller** (Michael Jackson, 1982): open. The entry is about the "Frog 13" sound of a Casio keyboard, which is a short stab in the breakdown, not the famous bassline (ARP 2600 according to MusicRadar). No source found gives the notes of either part.
- **Angel**, **Tour de France**: possible in part; not started.
- **THX Deep Note**: not possible (about 30 voices, the app has 8).

## Fact check (2026-11-23)
- **Lavengood 2019** (Journal of Popular Music Studies): E. PIANO 1 on 61 % of the 1986 R&B number-one hits is right; the country figure is 40 % (we had 42 %), the Hot 100 figure 39 %. Fixed in the DX7 guide and library card.
- **Roland SH-2 in Stranger Things**: Roland's own article, quoting Michael Stein, credits the SH-2 with the bassline and says the arpeggio was played by hand on an Oberheim; tutorials credit the arpeggio to the SH-2. Guide and library card now say that accounts differ.

## Drum round (2026-11-23)
- **Clap module**: an envelope that fires 1–6 very short spikes (Spread 3–40 ms apart) and then a tail (Decay), like the clap of a TR-808. Patched to a VCA after band-passed Noise it makes a hand clap. **Done**, new guide "Hand clap" in the drum group.
- **Patch sharing via link**: Patches menu → Share as a link. The patch travels inside the link (after `#`), nothing is uploaded. **Done** (2026-11-23).
