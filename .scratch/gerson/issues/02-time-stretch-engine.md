# 02 — Which time-stretch engine for pitch-preserved slow-down?

Type: research
Status: open
Blocked by: —

## Question

Gerson needs a global 0.5x–2x speed control with pitch preserved, applied to 4 stems playing
simultaneously and staying locked together.

Candidates: `soundtouch-js` (AudioWorklet), `rubberband-wasm`, SoLoud/signalsmith-stretch,
a hand-rolled phase vocoder, or the trivial-but-wrong `playbackRate` (which shifts pitch).

Resolve:

1. **Quality at 0.5x** on real polyphonic material — this is the practice case that matters most.
   Note artefacts: smearing on transients (drums), phasiness on sustained tone (vocals).
2. **Latency and CPU** for **4 concurrent instances** in AudioWorklets. Does a mid-range laptop hold
   up? Does a phone?
3. **Sync**: does the stretcher introduce variable latency? If each of the 4 instances can drift,
   that is fatal — establish whether a single shared stretch clock is required, or whether stretching
   a pre-mixed signal is impossible given per-stem mute/solo/volume must stay live.
4. **Seek and loop behaviour**: can it jump cleanly to an arbitrary position without a click or a
   flush glitch? This directly constrains the loop-region feature.
5. **Licence** and bundle size.

The sync finding (3) is the one that could reshape the whole playback architecture — lead with it.
