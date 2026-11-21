# Guided Builds on top of the sandbox

We added step-by-step Guided Builds after all (revising ADR 0001), but as a layer over the normal sandbox rather than a separate lesson mode. A guide never takes over the rack: the learner patches with the real controls, a spotlight shows where to tap, and the guide only watches the rack state and advances when the step's goal is reached. This keeps one way of patching to learn, and anything built in a guide is an ordinary patch afterwards.

## Considered Options

- Separate lesson screens with their own simplified UI: rejected, the learner would have to learn the interface twice.
- Scripted demo that patches by itself: rejected, watching is not learning. "Do it for me" exists per step only as an escape hatch.

## Consequences

- Steps are goals ("this cable exists", "Cutoff < 600 Hz"), not recorded taps, so any way of reaching the goal counts (drag or tap-tap, any order of jacks).
- Guides may start from an Example Patch; guide content lives in `js/guides.js` and refers to modules by alias.
- Goal checks run on a timer, independent of animation frames, so a throttled or backgrounded page still advances.
