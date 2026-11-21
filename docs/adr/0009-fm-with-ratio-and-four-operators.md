# FM with a VCO Ratio knob and a four-operator guide, not a 6-operator module

The VCO has a **Ratio** knob (0.5–16× in steps of 0.5, default 1) that multiplies its frequency, like a DX7 operator's frequency ratio. With it, the DX7 E-Piano guide builds 4 of the 6 operators of E.PIANO 1 from ordinary modules: two modulator → carrier pairs (ratio 14 for the metallic tine, ratio 1 for the warm body), each modulator behind its own VCA and ADSR, the carriers mixed, then chorus and reverb, played with 4 voices (ADR 0008).

## Considered Options

- A dedicated 6-operator FM module with algorithms: rejected for now. It would sound closer to the original but is a black box with dozens of knobs, so nothing about FM is patched or learned, and it does not fit an iPhone panel.
- The full 6 operators from ordinary modules: rejected for the guide. It needs about 18 modules and 30 cables, and a guide of far more than 60 steps.
- Keep the 2-operator guide: rejected. It misses the two-pair structure the source's tutorial teaches ("operators 1+2, then 3+4").

## Consequences

- FM here bends the pitch in cents (exponential FM) rather than the DX7's linear phase modulation, so timbres are DX7-like, not identical. The guide and library card say it is a simplified version and point to Dexed for the original.
- No code from Dexed (GPL) is used.
- Open for extension: the third, detuned pair (operators 5+6); linear FM / phase modulation; fixed-frequency operators; a 6-operator module as an optional "advanced" module later.
