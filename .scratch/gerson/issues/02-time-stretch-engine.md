# 02 — Which time-stretch engine for pitch-preserved slow-down?

Type: research
Status: resolved
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

## Answer

**Engine: `signalsmith-stretch` 1.3.2 (MIT), four independent AudioWorklet nodes, one per stem.**

**Sync verdict: four concurrent instances do not drift.** Its Web Audio wrapper never accumulates
position — it recomputes an absolute input sample index from the shared `AudioContext` clock on every
128-frame quantum and re-seeks the stretcher, so output length per call is fixed by the caller, not the
algorithm. Measured 0 samples of spread across 4 nodes over 10 minutes with 30 rate changes and an 8 s
loop. **Conditional on one rule:** every `schedule()` must carry an absolute AudioContext time in both
`output` and `outputTime`, identical across all four nodes. Omit it and they separate by 37 ms — 8 s at
a loop boundary. A single-stretcher architecture is not needed; per-stem mute/solo/volume stays a plain
`GainNode` each.

Also: 0.5x–2x is exactly the algorithm's clean window (`maxCleanStretch = 2`); 4 stems cost 5.1 % of one
core; ship `splitComputation: true` (caps worst quantum at 0.62 ms vs a 2.667 ms budget); loop/seek are
built in and click-free; 47.6 kB gzip, single file, no COOP/COEP.

**Runner-up: Rubber Band via `rubberband-wasm`** — likely better on drum transients, but GPL-2.0 (so
Gerson becomes GPL) and its real-time API is pull-based with variable output per call, so sample-lock
would have to be hand-built.

Findings: [`../research/02-time-stretch-engine.md`](../research/02-time-stretch-engine.md)
