# Gate cables are events, all other cables are audio-rate signals

Audio, CV and Pitch cables are real Web Audio connections, so any output can modulate any signal input. Gate cables are delivered as JavaScript on/off events instead, because detecting edges inside the audio graph would need an AudioWorklet per ADSR, adding complexity and latency risk on iOS Safari.

## Consequences

- Jacks have two kinds: signal and gate. Signal outputs only fit signal inputs; gate outputs only fit gate inputs. The "highlight compatible inputs" feature follows this rule.
- An LFO cannot clock the Sequencer or trigger an ADSR. Revisit if that becomes important.
