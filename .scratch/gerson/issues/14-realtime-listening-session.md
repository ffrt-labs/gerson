# 14 — Listening session: 0.5x quality and realtime behaviour

Type: prototype
Status: resolved
Blocked by: —

## Question

Split out of ticket 06. Everything here needs a human at a machine with an audio device — headless
Chromium has no audio output, so its `AudioContext` clock does not advance and no realtime result
from it can be trusted.

Harness note: each stem row shows a static `content dB` (what is in the decoded buffer) and a live
post-gain meter (what is reaching the speakers), plus an AudioContext diagnostic on play. Added
after a first session where "nothing works" was hard to attribute. On this instrumental, **vocals
reads ~−53 dB and that is correct** — there is no vocal to extract, so the stem is bleed only.

The harness is built and the real stems are already in place:

```
cd prototype/playback-harness && pnpm dev
```

### 1. The make-or-break: 0.5x by ear

`signalsmith-stretch` has **no transient detector**. 0.5x–2x is inside the algorithm's clean window
(`maxCleanStretch{2}`), but its own README recommends 0.75x–1.5x. The loaded material is a disco
instrumental — four-on-the-floor kick and hi-hats, the harshest realistic case.

Solo **drums** and listen at 1x, 0.75x, then 0.5x. Then the full mix. Judge one thing: **is this
good enough to practise against?** Not "is it hi-fi" — a practice tool can be a bit smeared. If
0.5x is unusable but 0.75x is fine, that is a perfectly good answer, and the tempo range in the
spec should shrink to match rather than advertising a speed nobody would use.

### 2. Realtime behaviour, unvalidated by the automated run

- **Windowed streaming**: switch buffer mode to `stereo (windowed 30s)`, play past 30s, change rate
  mid-playback. Probes upstream bug #22 (`RangeError` when the rate changes between chunks). The
  harness logs `addBuffers threw` if it fires.
- **Mid-playback rate change** — glitch or clean?
- **Seek** (the 30s button) — do all four stems land together, audibly?
- **Live mute/solo/gain** while playing — any zipper noise or dropout?
- **Loop 20–28s** over many iterations — the offline test says the wrap is clean; confirm by ear.
- **CPU**: four stretchers at 0.5x. Ticket 02 measured 5.1% of one core in Node; check a real tab.

### 3. Optional, ~30 minutes (carried from ticket 01)

Time a real 4-minute file in kramp's deployed ORT-web Space on this hardware, to see whether the
ONNX path has become competitive with demucs.cpp. Ticket 01's recommendation names this as the
condition for switching.

## Answer (partial — quality settled, realtime pending)

**1. 0.5x quality: PASSES.** Verdict from the listening session on the disco instrumental
(transient-dense, the harshest realistic case): soloed drums at 1x / 0.75x / 0.5x are **good enough
to practise against**. The absence of a transient detector in `signalsmith-stretch` does not
disqualify it at Gerson's operating point.

Consequence: **the full 0.5x–2x range ships.** No need to shrink the advertised tempo range, which
was the fallback if 0.5x had smeared. This closes the make-or-break risk carried since ticket 02.

**2. Realtime behaviour: still open.** See the checklist above — loop cycling, mid-playback seek,
and windowed streaming across a chunk boundary with a rate change (upstream bug #22).

---

## Answer (complete)

### 1. 0.5x quality — PASSES

Confirmed by listening on the disco instrumental (transient-dense, harshest realistic case). Soloed
drums at 1x / 0.75x / 0.5x are good enough to practise against. **The full 0.5x–2x range ships.**
The make-or-break risk carried since ticket 02 is closed.

### 2. Windowed streaming — DOES NOT WORK. Full-buffer only.

**Feeding a stem in more than one `addBuffers` call breaks playback**, silently and without throwing.

Found in realtime first: the playhead froze at ~30.3s in both a 1-stem and a 4-stem run, having
been topped up on schedule and fed out to 60s, with no error. Then isolated offline
(`test-chunks.mjs`) — same 60s of the drums stem, rendered 40s, fed either whole or split:

| feed | RMS 0–10s | RMS 20–29s | RMS 31–40s |
|---|---|---|---|
| one call (control) | −37.4 dB | −16.9 dB | −17.0 dB |
| split at 30s | −51.2 | **−180** | **−180** |
| split at 15/30/45s | −51.2 | **−180** | **−180** |
| split at 37s | −51.2 | **−180** | **−180** |

−180 dB is digital silence. Note the 37s case: audio dies at ~20s, well **inside the first chunk**.
So this is not a boundary-crossing fault — supplying more than one buffer corrupts playback from
early on, regardless of where the split is.

**This is not upstream bug #22.** That one is a `RangeError` on rate change between chunks. This
throws nothing at all. Suspected cause, from reading `process()` in the wrapper: the buffer walk
advances its cursor by the number of samples copied (`audioSamples += count`) rather than by the
full length of the chunk it just consumed, so its idea of where each chunk begins drifts as soon as
there is more than one. **Mechanism suspected, not proven** — the behaviour is what is established.

### Consequences

1. **Windowed loading is off the table** with `signalsmith-stretch` as it stands. Each stem must be
   supplied to its node in a single `addBuffers` call.
2. **Memory floor is therefore 311 MB** for a 4-minute song (four stems, stereo, transferred, with
   the decoded `AudioBuffer` dropped). Ticket 06's ~40 MB windowed figure is unreachable.
   Desktop is fine. **Mobile playback of long tracks is now a live risk** — feeds ticket 11.
3. **Mono playback buffers get promoted** from "unnecessary" back to the main lever available:
   155 MB instead of 311 MB, at the cost of stereo. A real trade for 12/11 to weigh, not for here.
4. If windowing is ever needed, it means patching the library and carrying a fork — a cost worth
   naming in the spec rather than discovering later.

### 3. Realtime behaviour — partially verified

Verified working in full-buffer mode: playback, mid-playback rate change, mute/solo/gain, and the
AudioContext clock advancing 1.00s/1s. Loop cycling and mid-playback seek were exercised during the
session without reported clicks, consistent with the offline loop measurements in ticket 06 — but
they were not the focus once the windowing fault surfaced, so treat them as "no problem observed"
rather than formally verified.

### Harness bugs found and fixed along the way (all mine, not the library's)

- `scheduleAll` re-sent `input` on every rate change. `schedule()` treats a supplied `input` as an
  **absolute seek**, so every tempo change teleported playback. **Only send `input` when seeking.**
  A genuine API footgun, alongside the `outputTime`/`output` one from ticket 06.
- The feeder dropped buffers to `playhead − 5s`; loop wrap and seek move the playhead backwards, so
  this could discard audio still needed. Now −15s and never past a loop start.
- The file picker guessed stem roles by filename substring and silently accepted the original song
  as a single "stem". **Carried to ticket 12** — that is exactly the identification problem it has
  to solve properly.
- The live cross-node spread readout coloured normal reporting phase (~2205 samples = one 0.05s
  update interval) as a failure. Now labelled with its floor.

