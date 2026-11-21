# Modular Synth Sandbox

A pocket modular synthesizer for absolute beginners: patch virtual Eurorack-style modules with cables, hear the result, and learn what each part does.

## Rack & patching

**Rack**:
The scrollable case that holds all modules of the current patch, arranged in rows.
_Avoid_: Canvas, board, workspace

**Module**:
One self-contained building block in the rack (e.g. VCO, VCF) with knobs and jacks.
_Avoid_: Node, device, component

**HP**:
Width unit of a module (Horizontal Pitch), as on real Eurorack panels.

**Jack**:
A socket on a module where a cable plugs in. Every jack is either an input or an output.
_Avoid_: Port, socket, connector

**Cable**:
A connection from exactly one output jack to exactly one input jack.
_Avoid_: Wire, link, connection

**Patch**:
The complete state of the rack: which modules exist, their knob settings, and all cables.
_Avoid_: Preset, project, sound

**Classic sound**:
A library entry about a famous synth sound: its story, what it teaches, and (if playable) a patch rebuilt with this app's modules.
_Avoid_: Preset, cover

**Inferred value**:
A knob value in a classic sound that the source does not give; a sensible starting point, marked "≈".
_Avoid_: Default, guess

**Example Patch**:
A read-only patch that ships with the app and demonstrates one concept.
_Avoid_: Template, demo

**Guided Build**:
A step-by-step recipe that leads the learner to build one target patch with the real rack.
_Avoid_: Tutorial, lesson, tour

**Tour**:
A walk through a finished Classic sound patch: a few explanations, each pointing at the modules it is about. The learner reads and listens; nothing has to be built.
_Avoid_: Guided Build (that one builds), demo

**Step**:
One goal inside a Guided Build, such as "this cable exists" or "Cutoff is below 600 Hz", with an explanation of why.
_Avoid_: Task, instruction

## Signals

**Signal**:
A continuously changing value carried by a cable. Audio and CV are both signals; they differ only in how they are used.

**Audio**:
A signal fast enough to be heard, meant to end up at the Output.

**CV** (Control Voltage):
A signal used to move a parameter of another module, such as pitch or cutoff.
_Avoid_: Modulation signal, automation

**Pitch**:
A CV that sets the note of a VCO. One unit equals one octave.
_Avoid_: V/Oct, note value, frequency CV

**Gate**:
An on/off signal that says "a key is held down now". Gates start and end envelopes and step sequencers.
_Avoid_: Trigger, note-on

**Signal type**:
What a cable carries: Audio, CV, Pitch or Gate. Shown by the cable's colour.

**Modulation**:
Patching a CV into a parameter so that the parameter moves on its own.

## Modules

**VCO** (Voltage-Controlled Oscillator):
Module that produces a tone with a chosen waveform (sine, triangle, saw, square).
_Avoid_: Oscillator, generator

**Noise**:
Module that produces random audio (hiss), with no pitch.

**VCF** (Voltage-Controlled Filter):
Module that removes part of the frequency range of an audio signal.
_Avoid_: Filter, EQ

**Cutoff**:
The frequency at which a VCF starts removing sound.

**Resonance**:
A VCF setting that boosts the frequencies right at the cutoff.
_Avoid_: Q, emphasis

**VCA** (Voltage-Controlled Amplifier):
Module whose loudness is set by a CV.
_Avoid_: Amp, volume

**ADSR** (Envelope):
Module that turns a gate into a CV shape: Attack, Decay, Sustain, Release.
_Avoid_: EG, envelope generator, contour

**LFO** (Low-Frequency Oscillator):
A slow oscillator whose output is used as CV, not heard directly.

**Mixer**:
Module that adds several signals into one.

**Delay**:
Module that plays its input back again after a set time, as echoes.
_Avoid_: Echo, tape delay

**Chorus**:
Module that adds slightly delayed, slowly drifting copies of a sound, left and right, making it wide and shimmering.
_Avoid_: Ensemble, doubler

**Reverb**:
Module that adds the fading reflections of a room to a sound.
_Avoid_: Hall, echo (an echo is a Delay)

**FM** (Frequency Modulation):
Bending one oscillator's pitch with another oscillator's output at audio speed, which creates new overtones.
_Avoid_: Cross-modulation

**Carrier / Modulator**:
In FM, the carrier is the oscillator you hear; the modulator is the one that bends it and is not heard directly.
_Avoid_: Operator as a general word (it is the DX7's name for either; see below)

**Operator**:
The DX7's name for one FM oscillator with its own level envelope. Here an operator is built from a VCO (wave Sine, a Ratio), a VCA and an ADSR. Used only when talking about the DX7.

**Ratio**:
The VCO knob that multiplies the frequency (0.5–16×). In FM the ratio between modulator and carrier decides which overtones appear.
_Avoid_: Harmonic, multiplier

**Output**:
The module that sends audio to the speaker and records it.
_Avoid_: Master, speaker

**Keyboard**:
The module behind the on-screen keys; outputs Pitch and Gate.

**Voice**:
One copy of the patch behind a Keyboard that plays one note. With Voices at 1 the synth is **monophonic** (one note at a time); above 1 it is **polyphonic**: every VCO, Noise, VCF, VCA, ADSR, LFO and Mixer behind the Keyboard is copied once per voice, while effects and the Output stay single.
_Avoid_: Channel, polyphony as a module

**Arp** (Arpeggiator):
Module that plays the notes of a held chord one after another, in a chosen order and tempo.
_Avoid_: Arpeggio module

**Rest**:
A sequencer step that is switched off: it is counted but plays no note.
_Avoid_: Mute, skip

**Key Tracking**:
The filter cutoff following the note that is played, so high notes stay as bright as low ones.
_Avoid_: Keyboard follow

**Sequencer**:
Module that steps through a loop of notes and outputs Pitch and Gate.
_Avoid_: Arpeggiator, step sequencer

**Pitch envelope**:
An envelope patched into a VCO's Pitch or FM input: a fast drop from high to low gives a kick drum its punch.

**Drum voice**:
A small patch that plays one drum: a VCO or Noise (or both, layered), an ADSR with zero Sustain, and a VCA. The Drum Kit Example Patch has three.
_Avoid_: Drum sample, drum preset

## Learning aids

**Info Mode**:
A state in which tapping anything shows an explanation instead of changing it.

**Expert controls (More page)**:
The second page of a module, shown with the More tab under the module name (Main goes back): controls for fine-tuning that a beginner does not need (ADR 0010).
_Avoid_: Advanced mode, settings

**Velocity**:
How hard a key is played; on the screen keys, how close to the front edge it is touched. The Keyboard's Vel output.

**Mod strip**:
The touch strip left of the keys; its value (0–1) comes out of the Keyboard's Mod output and stays where you leave it.
_Avoid_: Mod wheel (that is the hardware version)

**Unison**:
One key playing several detuned voices at once, for a fat sound.

**Clock**:
A module that sends steady Gate pulses so Sequencers and Arps play in time with each other.

**Slide / Accent**:
Per-step switches of the Sequencer: Slide glides into the step without a new attack; Accent sets the Acc output to 1 for that step.

**Ladder filter**:
The VCF type Lad: a model of the Moog ladder filter, steep and squelchy, self-oscillating at full resonance.

**Pulse width / PWM**:
How long a square wave stays high in each cycle; moving it (Pulse Width Modulation) gives a shimmering sound.

**Hard sync**:
A VCO restarting its cycle whenever another VCO starts one: a hard, tearing sound.

**Trigger**:
A module that turns any signal into a Gate while it is above a threshold.

**Sample & Hold**:
A module that takes a value at each Gate and holds it: steps from a smooth or random signal.

**Slew**:
A module that slows changes down: steps become slides.

**Ring modulator / Wavefolder / Quantizer**:
Ring multiplies two signals (bell and robot sounds); Folder folds a wave back on itself (bright, "west coast" tones); Quantizer snaps a pitch to a scale.

**Chapter**:
A section of a long Guided Build, with a pause after it; progress is saved per guide.

**Concept**:
An idea a guide teaches (Gate, Filter, FM …); finished guides tick their concepts off in the Guide list.

**Ear challenge**:
A task without steps: match a hidden target sound by ear, then Check how close you are.

**Scope**:
A live picture of a signal: in the cable sheet (tap a cable) or as the Scope module with two inputs, A and B, on one shared scale. Short Time settings show single vibrations with frequency and note; 1 s and 4 s roll slowly for envelopes and LFOs.
_Avoid_: Oscilloscope view, visualizer
