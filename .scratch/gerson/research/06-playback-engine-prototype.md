# 06 — Playback engine prototype: findings

Prototype: `prototype/playback-harness/` (throwaway). Driven headlessly by
`run-measurements.mjs` and `test-transfer.mjs`.

**Test material**: `Disco Ulysses Instrumental 128k.mp3` (3:51, 44.1kHz stereo), separated with
real `htdemucs` via the Python `demucs` package into vocals/drums/bass/other. Disco instrumental —
four-on-the-floor kick and hi-hats, i.e. exactly the transient-dense material that stresses a
stretcher with no transient detector.

**Environment**: macOS (Darwin 25.5.0), Chromium headless-shell 151, Node 22.16.

---

## Headline results

| Question | Result |
|---|---|
| Do 4 stretchers stay in sync? | **Bit-identical.** Stronger than expected. |
| Is 339 MB right? | **No — it is 622 MB.** Research counted one copy; there are two. |
| Can memory be fixed? | **Yes.** `addBuffers` transfers. Down to 311 MB, or ~40 MB windowed. |
| Offline render (gates export-with-tempo)? | **Works**, ~80x realtime. |
| Loop wrap clean? | **Yes**, across 5 positions and 3 rates. |
| 0.5x quality by ear? | **Not answered — needs a human.** |

---

## 1. Sync — bit-identical, not merely drift-free

Four nodes, same mono input, one `OfflineAudioContext`, rendered to 4 channels via a
`ChannelMerger`, 120 seconds, base rate 0.5x, with **30 rate changes** scheduled at irregular
times across {0.5, 0.75, 1, 1.5, 2}.

```
worstOffsetSamples: 0        renderMs: 3385
0 vs 1: sample-identical, max|Δ| = 0, offset 0
0 vs 2: sample-identical, max|Δ| = 0, offset 0
0 vs 3: sample-identical, max|Δ| = 0, offset 0
```

Not "within a sample" — **exactly equal, every sample**. Given identical input and an identical
absolute anchor, the four nodes are deterministic and produce identical output. Ticket 02's
simulation is confirmed against the real WASM.

### Methodological note — the obvious test is the wrong one

The first version of this harness compared `node.inputTime` across the four nodes live. **That
measurement is invalid** and was discarded: `inputTime` arrives by `postMessage`, and each node's
message can land in a different render quantum, so it reports up to 128 samples of spread that is
reporting jitter, not drift. The live readout is retained in the UI as an indicator only, labelled
as such. The cross-correlation of rendered output is the authoritative test.

### The usage rule is real and confirmed in source

`SignalsmithStretch.mjs`, `schedule()`:

```js
let outputTime = ('outputTime' in objIn) ? objIn.outputTime : currentTime;
```

But `start()` builds its own object with `output`, not `outputTime`. So **`start(numericTime)`
silently ignores the time it was given** and anchors to message arrival instead. This is a live bug
in the library's own convenience method, not just a documentation error. Gerson must call
`schedule()` directly and set **both** fields. The harness does; so should the app.

## 2. Memory — the research figure was half the real number

Exact computed byte counts for this 3:51 song, four stems, 44.1kHz float32:

| | decoded `AudioBuffer`s | copies inside worklets | **total** |
|---|---|---|---|
| stereo, full | 311.1 MB | 311.1 MB | **622.1 MB** |
| mono, full | 311.1 MB | 155.5 MB | 466.6 MB |
| stereo, 30s window | 311.1 MB | 40.4 MB | 351.4 MB |

Ticket 02 estimated 339 MB. It counted only the worklet-side copy. In the naive implementation the
decoded `AudioBuffer` **also** stays resident, so the real cost is roughly double. On a phone with
a ~1.5 GB WebContent limit, 622 MB for a four-minute song is not survivable alongside everything
else.

Process-RSS sampling was attempted via CDP and `ps`, and **is not reported**: `JSHeapUsedSize`
reads ~1.4 MB regardless of load (AudioBuffer backing stores and the WASM heap live outside the JS
heap), and renderer-RSS sampling swung between 192 MB and 1265 MB for the same configuration
across runs. The computed byte counts above are exact arithmetic and reproducible; the RSS numbers
were not, so no claim is made from them.

### The fix: `addBuffers` transfers

The wrapper's generated methods pop a trailing argument as the `postMessage` transfer list when
`args.length > argCount`. Verified empirically (`test-transfer.mjs`):

```
bytesBefore: 40771584   bytesAfter: 0   detached: true
```

The source `ArrayBuffer` is detached — the worklet takes ownership and no duplicate is made. So the
duplication is avoidable, and the recommended pipeline is:

**decode → extract channel data → `addBuffers(data, [transferList])` → drop the `AudioBuffer`.**

Steady-state cost becomes 311 MB (stereo, full song) or ~40 MB (30s window).

Better still, and this joins up with ticket 03: since 03 already pulls a **WASM FLAC decoder** in
for storage, Gerson can decode FLAC straight into a plain transferable `Float32Array` and **never
create an `AudioBuffer` at all** — avoiding both the duplicate and `decodeAudioData`'s
codec-roulette across browsers. Recommended.

## 3. Offline render — works, so export-with-tempo ships

```
works: true   renderMs: 126 for 10s of output   ~80x realtime   peak 0.0667   99.5% non-silent
```

Ticket 04 made its apply-tempo-on-export checkbox conditional on this. **The condition is met** —
the stretcher renders in an `OfflineAudioContext` far faster than realtime, so exporting a
slowed-down practice mix is cheap. 04's design can ship as written.

(An earlier run of this test used `Object.values(buffers)[0]`, which on an instrumental track is
the near-silent vocals stem — peak 0.004. Switched to drums; the check is now meaningful.)

## 4. Loop wrap — clean across positions and rates

A single loop boundary proves little: if it lands in a quiet bar, no click shows regardless. So the
test measures the largest sample-to-sample jump within ±5 ms of each predicted wrap, expressed as a
multiple of the whole render's RMS jump, and compares it to the material's own loudest transient.

| Loop | worst wrap (×RMS) | loudest transient in material (×RMS) |
|---|---|---|
| 20–24s @ 1x | 0.1 | 30.7 |
| 20–24s @ 0.5x | 0.1 | 28.3 |
| 37.3–40.1s @ 1x | 0.2 | 25.2 |
| 90–92s @ 0.75x | 9.3 | 23.9 |
| 128.5–132.5s @ 1x | 0.2 | 26.8 |

Every wrap stays well inside the material's own jump distribution — the worst case (9.3) is still
below a third of an ordinary kick transient. No wrap-aligned discontinuity. Non-integer boundaries
and fractional rates behave the same as tidy ones.

## 5. Windowed streaming — NOT VALIDATED

`addBuffers`/`dropBuffers` top-up while playing, probing upstream bug #22 (`RangeError` on rate
change between chunks). The run reported zero errors, **but the result is worthless**: headless
Chromium has no audio device, so the `AudioContext` clock advanced 2.98 s over 15 s of wall clock.
The feeder never fired. The harness now detects and flags this rather than reporting a false pass.

Windowed streaming, and every other realtime behaviour (live mute/solo, mid-playback rate change,
seek), **must be re-run in a real browser**. The harness UI does all of it; it needs a human with
an audio device.

## 6. Incidental findings

- **Native separation took 17 seconds** for this 3:51 track (PyTorch, this Mac) versus the ~9
  minutes ticket 01 quotes for browser WASM across 8 workers. That is a ~30x penalty for running
  in-browser. It does not change the no-server decision, but it is the honest number and belongs in
  the spec's known-limits section.
- **Four stems as 16-bit WAV came to 163 MB** (40.8 MB each), matching ticket 03's ~160 MB estimate.
- **Bundle**: the harness built to 111.32 kB raw / **49.01 kB gzip**, corroborating 02's 47.6 kB
  figure for the library, inline WASM included.
- **Decoding in an `OfflineAudioContext` pinned to 44100** (ticket 04's advice) worked without
  incident; all four stems decoded to 44100 / 2ch / 10192896 frames, lengths identical.
- **The `demucs` pip package does not install numpy**, despite importing it. Trivial, but it will
  bite anyone reproducing the stem generation.

---

## What this changes

1. **Ticket 03 should be revisited** — not reversed. Its stereo-lossless-FLAC decision stands
   (memory is fixable without touching storage format), but the *loading path* it implies should
   become "decode FLAC in WASM to a transferable Float32Array", not "decode to an AudioBuffer".
2. **Ticket 04's export-with-tempo checkbox is unblocked** and can ship.
3. **Mono playback buffers are not needed** as a memory measure. Transfer plus dropping the
   `AudioBuffer` gets further, and keeps stereo.
4. **Windowing is optional, not required** — 311 MB is survivable on desktop. It stays worth having
   for long tracks and for mobile playback, but it is no longer load-bearing.
