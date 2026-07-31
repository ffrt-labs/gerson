# 06 — Prototype: do 4 stretched stems stay in sync?

Type: prototype
Status: resolved
Blocked by: 02, 04

## Question

The single biggest technical risk in the player. Build a throwaway prototype (via `/prototype`,
under `prototype/`, not app code) that proves or kills the playback architecture.

It must demonstrate, with 4 real stem files:

1. Four stems playing **sample-locked** together, with per-stem gain and mute/solo applied live.
2. Global time-stretch at **0.5x, 0.75x, 1x, 1.5x** with pitch preserved — and stems still locked
   after several minutes of playback (drift is cumulative; a 10-second test proves nothing).
3. **Seeking** to an arbitrary position with all four stems landing on the same sample.
4. A **loop region** that repeats cleanly — no click, no drift accumulating across loop iterations.
5. Toggling mute/solo and changing tempo **mid-playback** without a glitch or a resync.

Record the CPU cost with all four running, and the behaviour when the tab is backgrounded.

## What research already settled — do not re-litigate

Ticket 02 resolved the architecture: **four independent `signalsmith-stretch` AudioWorklet nodes**,
sync verified as non-cumulative (±0.5 sample, 0 spread over a simulated 10 minutes). So this
prototype is no longer asking *whether* sync works. It must still **confirm the simulation against
the real shipped WASM in a real browser**, and it must obey the one usage rule 02 found: pass the
schedule anchor explicitly, absolute, as the identical object to all four nodes, setting both
`output` and `outputTime` (the README and the wrapper source disagree on the field name). Ship
`splitComputation: true`.

## What this prototype must now actually decide

1. **Memory.** 02's headline problem: the node only stretches in buffer mode, so each node owns its
   stem's PCM — **339 MB for a 4-minute song**. Does that survive a desktop tab? A phone tab?
   Trial the mitigations: mono playback buffers, and windowed loading via `addBuffers`/`dropBuffers`.
   Note 02 found an open upstream bug (#22, `RangeError` when rate changes between chunks) on the
   streaming path — exercise it early if windowing looks necessary.
   This may push back on 03's stereo-FLAC storage decision. If it does, say so; 03 can be revised.
2. **Quality at 0.5x, by ear.** The one thing research could not answer. 0.5x–2x is exactly the
   algorithm's clean window (`maxCleanStretch{2}`), but the README recommends 0.75x–1.5x and there is
   **no transient detector at all** — so drums at 0.5x are the specific risk. A/B against the
   original and judge whether it is good enough to practise to. This is the make-or-break for the
   headline feature.
3. **Offline render.** Can the stretcher render in an `OfflineAudioContext`? Ticket 04's
   apply-tempo-on-export checkbox ships only if it can; if it is realtime-only, tempo is dropped
   from export rather than rendered in realtime.
4. **Opportunistic, ~30 minutes** (from 01): time a real 4-minute file in kramp's deployed ORT-web
   Space on this hardware, to check whether the ONNX path has become competitive with demucs.cpp.

Still to demonstrate from the original list: seeking, loop-region cleanliness across many
iterations, and live mute/solo/tempo changes without a glitch.

## Answer

Prototype: `prototype/playback-harness/`. Full findings:
[research/06](../research/06-playback-engine-prototype.md). Material: the reference disco
instrumental, separated with real `htdemucs`.

**Architecture confirmed.** Four independent `signalsmith-stretch` AudioWorklet nodes on a shared
absolute anchor. Sync is **bit-identical** — 4 nodes, 120s, 30 rate changes at 0.5x base, all pairs
sample-identical, max|Δ| exactly 0. Stronger than ticket 02's simulated 0-sample spread.

**The `outputTime` rule is a real library bug, not a doc error**: `start(numericTime)` silently
ignores the time because `schedule()` reads `outputTime` while `start()` writes `output`. Call
`schedule()` directly and set both fields.

**Memory: 02's 339 MB was half the truth — it is 622 MB** (311 MB decoded AudioBuffers + 311 MB of
worklet copies, 3:51 song). Fixable: **`addBuffers` transfers** (verified — source ArrayBuffer
detaches), so decode → transfer → drop the AudioBuffer gives 311 MB, or ~40 MB with a 30s window.
Better, joining ticket 03: decode FLAC in WASM straight to a transferable `Float32Array` and never
create an `AudioBuffer`. **Mono buffers are not needed**; windowing becomes optional, not required.

**Offline render works** (~80x realtime), so **ticket 04's export-with-tempo checkbox ships**.

**Loop wrap is clean** across 5 positions and 3 rates, including non-integer boundaries — every
wrap stays inside the material's own transient distribution.

**Not answered — carried forward:** (1) 0.5x quality by ear, the make-or-break, needs a human;
(2) all realtime behaviour (windowed streaming / upstream bug #22, live mute-solo, mid-playback
rate change, seek) could not be validated — headless has no audio device and the AudioContext clock
did not advance. Both need a browser session. See ticket 14.

