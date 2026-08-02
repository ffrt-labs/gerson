# Gerson — build spec

A fully-offline, browser-only PWA for practising along to recorded music: upload a song, split it
into four stems, and play them back isolated, slowed down, and looped.

This spec is the output of the [wayfinder map](map.md) and its fourteen tickets. **Everything here
is decided.** Where a decision looks arbitrary, the reasoning is stated — usually because the
obvious alternative was tried and rejected for a specific, measured reason. Links go to the ticket
that owns the detail; open the ticket rather than re-deciding.

**Do not re-litigate.** If something here seems wrong, the ticket it links to has the numbers.

---

## 1. What Gerson is

- **Desktop web only.** Static build, no server, ever. Any design that reintroduces a backend is
  wrong for this project.
- **Separation runs in the browser** — WASM, on the user's CPU. ~9 minutes for a 7-minute song.
- **Four stems**: vocals, drums, bass, other. Guitar and keys live in "other".
- **A practice tool, not a DAW.** Global tempo, one loop region, per-stem level and mute.
- **Offline after first use**: one shell load and one model fetch, then everything works with the
  network off.

### Stack

Vite + React + TypeScript, static build, `vite-plugin-pwa`. No COOP/COEP headers are needed
([01](issues/01-browser-inference-runtime.md), [02](issues/02-time-stretch-engine.md)), so any
static host works.

### Non-goals

Carried from the map's Out of scope. These are decided *against*, not merely unbuilt.

| Non-goal | Why |
|---|---|
| **BPM and key detection** | A separate accuracy problem. Tempo is a relative multiplier; Gerson never displays a BPM. |
| **Metronome / beat grid** | Depends entirely on beat detection. Nothing in the UI snaps to anything. |
| **6-stem separation** (guitar, piano) | Weaker quality, bigger and slower model. |
| **Cross-device library sync** | Needs a server. Export/import is the entire story for moving a library. |
| **Mobile — phones and tablets** | Desktop web app. See §9 for the one guard that remains. |
| **Training or fine-tuning a model** | A different project. Gerson uses published pretrained Demucs weights. |
| **Reference-mix A/B** | A fifth `signalsmith-stretch` node and buffer is +78 MB on top of an already-unavoidable 311 MB playback floor ([14](issues/14-realtime-listening-session.md)); [10](issues/10-waveform-rendering.md) ruled out a fifth waveform lane on the same grounds. Imported Songs have a *summed* Recording ([12](issues/12-import-exported-stems.md) §6), so "compare against the original" would sometimes be a lie. Cheap to add later — the transport already exists. |
| **Content-based role detection** on import | A research project that recreates the invisible-guess failure with more machinery ([12](issues/12-import-exported-stems.md) §3). |
| **Folder drop** (`webkitdirectory`) on import | A third input shape for a case zip-or-loose-files already covers. |
| **Mid-inference resume** | Per-segment checkpoints are large and fight the memory ceiling ([07](issues/07-separation-job-ux.md)). |

---

## 2. Domain model

Glossary — the words the UI and the code both use — lives in [`CONTEXT.md`](../../CONTEXT.md).
Full schema and reasoning: [05](issues/05-domain-model.md),
[research/05](research/05-domain-model.md).

```
Separation  ──succeeds──>  Song ──has──> exactly 4 Stems (one per Role)
                            │
                            ├──has──> 1 Recording   (kept, never discarded)
                            └──has──> 1 Practice state
```

Three invariants that shape everything downstream:

1. **A Separation is a separate noun, not a Song with a status.** An upload becomes a Separation;
   it becomes a Song only once four Stems exist. Therefore **if it is in the library as a Song, it
   plays** — a Song that cannot play is unrepresentable, and a failed job leaves no broken Song
   behind.
2. **A Song is exactly four Stems with four fixed Roles.** Not an open list. A set that is not
   exactly these four cannot be opened.
3. **Identity is a content hash of the Recording bytes**, shared by the Separation and the Song it
   becomes. Re-dropping a known file opens the existing Song rather than paying nine minutes twice.

### Storage layout

**OPFS holds all audio bytes. IndexedDB holds the catalogue and never a blob.**
([03](issues/03-stem-storage.md))

#### `songs`

| field | type | notes |
|---|---|---|
| `id` | string | content hash — see invariant 3 |
| `title` | string | from the filename, user-editable |
| `durationSec` | number | |
| `sampleRate` | number | always 44100 ([04](issues/04-audio-decode-and-export.md) pins decode to it) |
| `createdAt` | number | epoch ms |
| `recording` | `{ path, bytes, mimeType, origin }` | OPFS path; `origin: "uploaded" \| "summed"` |
| `stems` | `Record<Role, StemRef>` | exactly four keys |
| `practice` | `PracticeState` | |

- `Role = 'vocals' | 'drums' | 'bass' | 'other'` — closed set.
- `StemRef = { path, bytes, peaksPath }`.
- `PracticeState = { tempo: number, loop: { startSec, endSec } | null, stems: Record<Role, { gain: number, muted: boolean }> }`
  — `tempo` 0.5–2.0 default 1; `gain` 0–1.5 default 1.

**Persisted**: tempo, loop region, per-stem gain and mute.
**Not persisted, by decision**: solo and playhead. Both are momentary gestures, and reopening a
Song to three silent stems reads as a bug. Playhead resets to 0, or to `loop.startSec` when a loop
is set.

`recording.origin` lives on the **Recording, not the Song** — a Song is a Song regardless of how it
arrived, nothing branches on it, and there is **no "imported" badge in the library**. It exists
because re-separating a sum-of-Demucs is a meaningfully worse input, and because calling a summed
mix "Original" would be a small lie.

#### `separations`

| field | type | notes |
|---|---|---|
| `id` | string | content hash — the same value the Song will take |
| `title` | string | from the filename |
| `status` | `'queued' \| 'running' \| 'failed'` | no `'complete'` — on success the record is deleted and a Song is written |
| `uploadPath` | string | OPFS path to the uploaded bytes, so a reload never needs re-upload |
| `progress` | number | 0–1, from demucs.cpp's `PROGRESS_UPDATE` |
| `error` | string \| null | populated when `failed`; a cancellation is not an error |
| `startedAt` | number | epoch ms |

Sharing the id makes the transition a delete-and-insert under one key, and lets a duplicate upload
be detected against in-flight work as well as the finished library.

**Write order is load-bearing**: OPFS files first (stems *and* peaks), catalogue record last. So a
catalogue row always implies its files exist.

---

## 3. The separation pipeline

End to end: file in → decode → hash → queue → workers → stems + peaks → storage → Song.

### 3.1 Decode first, always

**No Separation is enqueued before its file has decoded.** ([11](issues/11-failure-surface.md) §2)
The PCM is needed to feed Demucs anyway, so the guard is free — and it means a bad file costs
seconds instead of nine minutes. This ordering is not an optimisation; it is the design.

- Decode in an **`OfflineAudioContext` pinned to 44100**. `decodeAudioData` resamples to the context
  rate, so an unpinned context silently round-trips 44.1 → 48 → 44.1 before Demucs sees the audio.
- **`decodeAudioData` detaches the input `ArrayBuffer`** — keep a copy if the bytes are needed after.
- **No chunked decode.** A 10-minute stereo track is 212 MB as float32; the four stems are the real
  pressure and chunking does not help. WebCodecs `AudioDecoder` would also need a hand-written
  demuxer. ([04](issues/04-audio-decode-and-export.md))
- **No format list is ever advertised.** The picker accepts `audio/*`. Detection is "try the decode"
  — there is no static list, because `decodeAudioData` inherits each browser's `<audio>` codec set.

### 3.2 Storage pre-flight

Call **`navigator.storage.estimate()` before enqueuing** and compare free space against the known
result size (~93 MB of stems plus the retained Recording). Refuse up front if it will not fit. The
write otherwise lands at the *end* of a nine-minute job — maximum work, total loss.

Call **`navigator.storage.persist()`** at first save.

### 3.3 Inference

**`sevagh/demucs.cpp` compiled to WASM ourselves**, driven by N ordinary Web Workers.
([01](issues/01-browser-inference-runtime.md), [research/01](research/01-browser-inference-runtime.md))

- **Model**: GGML **f16 `htdemucs` 4-source, 80.1 MB**, MIT code and MIT weights, converted from
  Meta's frozen `955717e8` checkpoint. **Do not reuse freemusicdemixer's prebuilt `.bin` — those
  weights are explicitly proprietary.** Only their code is MIT.
- **Vendor `demucs.cpp` at a pinned commit.** Upstream last pushed 2024-12-01 — complete and
  dependency-light (Eigen + C++17), but 20 months stale. Do not track its default branch.
- **API**: `_modelInit(bytes)` then `_modelDemixSegment(L, R, len, 7×L/R out ptrs, batch)`. PCM in,
  four PCM buffers out.
- **Progress is real**, posted from C++ as `{ msg: 'PROGRESS_UPDATE', data: 0..1 }`. Show it as a
  true percentage with no invented smoothing.
- **Parallelism is N independent single-threaded WASM instances** — no SharedArrayBuffer, no
  COOP/COEP. This is why plain static hosting works.
- **Worker count is memory-bound, not core-bound**: peak is ~2.3–2.5 GB RSS *per worker*. Size by
  RAM — one worker per 4 GB — and **infer it silently; it is not user-facing.**
- **Timing to state honestly**: ~9 minutes for a 7-minute song across 8 workers; ~5 minutes for a
  4-minute song. Show the estimate up front.

**Runner-up, and the condition to switch**: ONNX Runtime Web + `StemSplitio/htdemucs-onnx`
(fp16, 158 MB, MIT) has a cleaner single-graph API and a live runtime, but today measures 10–15
min/song on WebGPU. **Switch when a measured browser WebGPU run separates a 4-minute song in under
~4 minutes**, or if COOP/COEP becomes necessary for another reason.

### 3.4 Peaks, in the same pass

Peaks are **Int8 min/max pairs at 256 samples/pixel**, ~82.7 KB per stem. They are computed **at the
moment the stems are produced**, in the streaming pass while the PCM is already decoded and on its
way to the FLAC encoder — marginal cost ~zero — and written **in the same commit as the stem files**.

So **a Song in the library implies its peaks exist**, matching invariant 1. Lazy-on-first-open was
rejected: it costs a full FLAC decode of four stems to draw a picture.

**Repair path**: if a peaks file is missing or its length does not match the stem, recompute from
the stored FLAC on open. Peaks are regenerable; partial eviction should cost seconds, not the Song.

### 3.5 Storage format

**Lossless FLAC, 16-bit 44.1 kHz stereo, level 5**, encoded *and* decoded by a WASM codec (no
browser exposes a FLAC encoder; Chromium's `AudioEncoder` does Opus and AAC only).

**Lossy was rejected on the merits, not on principle** ([03](issues/03-stem-storage.md)): Opus has
no 44.1 kHz mode (its internal rate is always 48 kHz), **soloing removes exactly the masking its
bit allocation assumes**, and 0.5× stretching smears codec pre-echo — which is Gerson's operating
point, not an edge case. Compression buys nothing we need: a 20-song FLAC library is 1.87 GB against
a ~60% -of-disk quota. **Quota is not the binding constraint.**

Worked example, 4-minute song: ~93 MB of stems, plus the retained Recording (~1% of the total for a
compressed upload), plus ~330 KB of peaks.

### 3.6 Job behaviour

([07](issues/07-separation-job-ux.md), [research/07](research/07-separation-job-ux.md))

- **The app stays fully usable during a job** — browse the library, open another Song, practise.
  Nine minutes is far too long to hold the app hostage.
- **The CPU contention is stated, not hidden.** A plain line attached to the running job, in neutral
  language, **not styled as a warning**: *"Playback may stutter while a separation is running."* It
  is the consequence of a deliberate design choice, not an error.
- **One Separation runs at a time; the rest queue**, showing queue position, reorderable and
  cancellable. Concurrency is pointless when worker count is memory-bound — two jobs each get half
  the workers, both take twice as long, at double the peak memory.
- **Cancel works on running and queued alike**, deleting the Separation and its bytes.
- **Interrupted jobs ask before restarting.** Workers die with the page — no Service Worker can hold
  multi-minute inference — so a `running` Separation reverts to `queued` on load, shows as
  *interrupted*, and waits. Resuming means starting over, and says so. Gerson never silently commits
  the machine to nine minutes of CPU because someone opened a tab.

---

## 4. Playback

**Proven by prototype, not merely designed.** ([06](issues/06-playback-engine-prototype.md),
[14](issues/14-realtime-listening-session.md), [research/06](research/06-playback-engine-prototype.md))

### 4.1 Architecture

**Four independent `signalsmith-stretch` (1.3.2, MIT) AudioWorklet nodes, one per stem**, each
followed by a plain `GainNode`. 47.6 kB gzip, inline base64 WASM, so it precaches with the shell for
free.

**Sync is bit-identical** — measured across 4 nodes, 120 s, 30 rate changes at 0.5× base: all pairs
sample-identical, max |Δ| exactly 0. The wrapper never accumulates position; it recomputes an
absolute input sample index from the shared `AudioContext` clock every 128-frame quantum. A
single-stretcher architecture is **not** required, so per-stem gain, mute and solo stay trivially
live.

**0.5×–2× ships in full.** Confirmed by ear on transient-dense material (a disco instrumental —
four-on-the-floor kick and hi-hats, the harshest realistic case): soloed drums at 0.5× are good
enough to practise against, despite the library having no transient detector. This closed the
make-or-break risk carried since 02.

Ship **`splitComputation: true`** — worst-case quantum 10.5 ms → 0.62 ms against a 2.667 ms budget,
at a cost of 30 ms latency. Four stretchers cost ~5% of one core.

### 4.2 Three API footguns — all three cost a debugging session already

These are the reason this section exists. Each was found the hard way.

1. **Call `schedule()` directly and set both `output` and `outputTime`** to an identical absolute
   `AudioContext` time across all four nodes. `start(numericTime)` silently ignores its argument,
   because `schedule()` reads `outputTime` while `start()` writes `output`. Omit the anchor and the
   nodes separate by 37 ms steadily, and by **8 seconds at a loop boundary**.
2. **Only send `input` when seeking.** `schedule()` treats a supplied `input` as an **absolute
   seek** — sending it on a tempo change teleports playback.
3. **Feed each stem in exactly one `addBuffers` call.** See §4.3.

### 4.3 Full-buffer only — windowed streaming does not work

Feeding a stem in **more than one** `addBuffers` call **breaks playback silently**: digital silence
(−180 dB), no exception thrown, and it fails *before* the split point, so it is not a
boundary-crossing bug. Reproduced in realtime (playhead froze at 30.3 s) and isolated offline across
four split configurations. **This is not upstream bug #22** — that one throws a `RangeError`.

Consequences, all binding:

- **Memory floor is 311 MB for a 4-minute song** — 78 MB/min stereo, 39 MB/min mono. 06's ~40 MB
  windowed figure is unreachable.
- **If windowing is ever needed, it means patching the library and carrying a fork.** Named here so
  it is a known cost rather than a later discovery.

### 4.4 Loading stems

**Decode FLAC in the WASM codec straight into a transferable `Float32Array`; never create an
`AudioBuffer`.** `addBuffers` transfers (verified — the source `ArrayBuffer` detaches), so this
avoids the duplicate residency 06 measured (622 MB → 311 MB) and sidesteps `decodeAudioData`'s
cross-browser codec roulette entirely.

**Load stems sequentially — transfer and drop each before decoding the next.** A parallel load
spikes to steady-state plus four; sequential keeps the spike one stem wide (~19 MB/min).

### 4.5 Memory policy

Playback cost is **exactly computable before decoding a byte**; the device budget is not
(`navigator.deviceMemory` is absent in Safari, `performance.memory` is Chrome-only). So policy runs
on the half we know exactly.

- **Desktop budget: 2 GB.** A 25-minute track still plays in stereo, so in practice this never
  fires — which is the intent. Desktop has swap and catchable errors; do not nag people who do not
  need it.
- **Under budget** → proceed silently in stereo, no message.
- **Over budget** → **warn and attempt**, stating the computed number. Never a hard refusal: unlike
  a job that is *known* to die, here we may simply be wrong about the budget.
- **Mono is always available as a manual override** — half the memory, a mild loss when practising.
  It is a **playback-time downmix after decode, before `addBuffers`**; stems stay stereo FLAC on
  disk. Reversible without re-encoding.

Mono is a **device-level preference in `localStorage`, not part of `PracticeState`** — the same
library may want different answers on different machines.

### 4.6 Transport and playhead

- The playhead is **main-thread arithmetic** from the `{ input, output, rate }` transport anchor
  against `audioContext.currentTime` — never read from the worklet.
  `stretch.inputTime` via `setUpdateInterval()` was rejected: it is message-driven with a 0.05 s
  floor, and a 20 Hz playhead visibly stutters against a 60 fps repaint. As arithmetic it stays
  correct through a rate change the instant the anchor is replaced.
- **Apply the same loop wrap the worklet applies** (subtract the loop length past `loopEnd`), or the
  drawn playhead sails off screen while the audio correctly repeats.
- **Evaluate at `currentTime − outputLatency`**, so the line sits on what is in your ears rather
  than what is in the buffer. Tens of ms — small, but visible against a transient at 0.5×.
- Loop wrap and seek are clean, verified across 5 positions and 3 rates including non-integer
  boundaries.

### 4.7 Offline render

The stretcher **renders in an `OfflineAudioContext` at ~80× realtime**. This is what makes
export-with-tempo possible (§6).

---

## 5. Waveforms and the loop region

([10](issues/10-waveform-rendering.md))

### 5.1 Zoom — zoomable, one stored resolution

**Zoomable, with exactly one stored peaks resolution.** Zooming out aggregates the same Int8 array
on the fly (min of mins, max of maxes); zooming in stops at **1 pair per pixel = 5.8 ms/px**. No
second peaks format, no PCM re-read, no extra storage. Range: fit-the-song at minimum, 1 pair/px at
maximum.

Fit-the-song-only was rejected on a number: it makes **one pixel = 0.2 seconds** — roughly a
sixteenth note at 120 bpm of slop on *each* loop edge, with no beat grid to snap to. That is not
precise enough to loop a lick, which is the app's core gesture.

### 5.2 Viewport — static, with a sweeping playhead

**The viewport holds still and the playhead sweeps across it.** Auto-follow engages only when the
playhead leaves the viewport, and **any interaction — loop drag, pan, zoom — defeats follow until
re-armed**, or the view yanks itself away mid-drag.

**This is what makes everything else cheap**: between gestures the waveforms are static bitmaps, so
the 60 fps bar applies to a line, not to four waveforms.

Continuous scroll was rejected on both cost (**~53 MB of offscreen bitmap at max zoom**, on top of
the 311 MB floor) and fit (inside a loop the region is stationary and on screen — a scrolling view
would animate constantly to show you the same 8 bars).

### 5.3 Render target

**Four canvas 2D elements, one per stem row, plus one absolutely-positioned overlay canvas spanning
all four rows** for the playhead and loop shading. Every canvas sized to `devicePixelRatio`.

- Per-track canvases because track state changes independently (muting bass redraws bass alone), and
  each row stays a normal DOM element Claude Design can style without layout living in canvas math.
- One overlay because **the playhead and loop region are song-level, not track-level** — matching
  the one-loop-per-Song schema. The 60 fps path never touches a waveform bitmap.
- **WebGL buys nothing** and costs shaders, context-loss handling, and a fallback path. A redraw is
  one path of ~1200 vertical segments — low single-digit ms, on a gesture, not per frame.
- **Main thread, no OffscreenCanvas.** During a continuous pan or zoom, `drawImage` the existing
  bitmap scaled and translated to the new viewport — one GPU-friendly blit per row, slightly soft
  while the pointer moves, which nobody notices mid-gesture — then **re-render sharp from the peaks
  on gesture end.** OffscreenCanvas stays a documented escape hatch; the swap is local to the render
  function.

**Four rows only. The Recording is not a lane.** (See non-goals.)

### 5.4 The loop region — a dedicated lane, and nothing snaps

**A dedicated loop lane running the full timeline width, above the four tracks and pixel-aligned
with them.** Drag in the lane creates a region; its edges drag there; dragging its middle moves it
without resizing. The region is **shaded down through all four waveforms** by the overlay canvas —
visible everywhere, draggable only in the lane.

This leaves the waveforms one unambiguous gesture: **click to seek.** Drag-on-waveform was rejected
because seek and loop would compete for one surface, forcing a drag-threshold heuristic that is most
ambiguous when the drag is short — which is the common case.

**Nothing snaps and no grid is invented.** There is no beat grid, and zero-crossing snap is
meaningless across four stems that cross at different times. Precision comes from three other places:

1. **Zoom** — 5.8 ms/px at the limit.
2. **Set loop start / end from the playhead** — place an edge by ear rather than by eye.
3. **A numeric readout** of start / end / length, nudgeable.

**The set-from-playhead and numeric controls are load-bearing, not a power-user extra.** You find a
loop edge by listening, not by pointing. They are not droppable in visual design.

---

## 6. Export and import

**These two ship together as one phase** ([12](issues/12-import-exported-stems.md) §7). The export
side writes the tags the import side reads; shipped apart, the round-trip degrades to manual mapping.

### 6.1 Export — two commands

| | Export stems | Export mix |
|---|---|---|
| contents | four files, one per Role | one file |
| mute / solo / gain | **ignored** | **honoured** |
| loop | ignored | honoured |
| tempo | **always 1×** | 1× by default, **off-by-default** apply-tempo checkbox |

"Export stems" is the interop and re-import artifact, so it must be neutral. "Export mix" is a
rendering of what you are hearing, so it is not.

**Format: FLAC by default on both commands, with WAV a visible alternative on both.** The codec is
already in the bundle for storage, FLAC is ~60% the size, and — decisively — **FLAC is the format
that round-trips**, because WAV has no tag block a decoder respects. Say so where the choice is
offered: *WAV stems re-import through manual role mapping.*

**Exported FLAC stems carry Vorbis comments**: role, the song's `id`, a schema version, and the
title. This is what lets a song exported on one machine import elsewhere as **the same Song** rather
than a ~93 MB duplicate. A `manifest.json` was rejected — the non-Chromium path is four loose
downloads, so a manifest becomes an awkward fifth file, and any file that can be separated from its
audio eventually is.

**Build-time check, do not assume**: libFLAC writes metadata blocks natively, so the WASM encoder
should already support this. **Confirm it.**

**Delivery ladder**: `showSaveFilePicker` (Chromium only — not coming to Safari or Firefox) →
`<a download>` (universal) → `navigator.share({ files })`. Multi-file export is a **STORE-only zip
streamed into the picker on Chromium; four sequential downloads elsewhere.**

### 6.2 Import

Two rules generate almost every decision here: **never guess invisibly**, and **never make the user
pay for the same nine minutes twice.**

- **One drop zone. The drop decides**: a single `.zip` is unpacked, multiple audio files are the set.
  No mode switch — the user should not have to tell the app which shape of export they are holding.
  **Support deflate as well as STORE** (`DecompressionStream('deflate-raw')` is native everywhere);
  third-party packs are likely deflated. **A zip is a container, not a promise** — unpacked contents
  take exactly the same path as loose files.
- **Identity is checked before any work.** If the tagged `id` — or the synthesised hash — is already
  in the library, **open that Song** instead of importing.
- **Tagged sets** adopt the embedded `id`, so the Song survives the trip.
- **Untagged sets** (our own WAV exports, Demucs CLI, Spleeter, downloaded packs) go through an
  **explicit four-dropdown role mapping. Nothing proceeds until all four are assigned.**
  Filenames may **prefill** only on an unambiguous four-distinct-role match; a partial or ambiguous
  match prefills nothing, because half-guessing produces a form that looks already-correct.
  **Prefill is a suggestion the user commits to, never an auto-accept** — 14's failure was that the
  guess was *invisible*, not that it was wrong. **Filenames are never trusted for role.**
- **The Recording is synthesised by summing the four stems**, and `recording.origin = "summed"`.
  The deciding reason is **identity**: `id` hashes the Recording, so with none there is nothing to
  hash and re-import silently duplicates ~93 MB. A sum of deterministic FLAC decodes is
  deterministic, so the same four files always yield the same id. It is also *true* — Demucs stems
  sum back to the input by construction. Cost: one summing pass plus one more FLAC (~25% on top of
  the stems).
- **Peaks are computed during import**, in the same pass that decodes each file to verify it is
  valid audio.

**Validation:**

| check | behaviour |
|---|---|
| sample rate mismatch | **not a rejection** — decode is pinned to 44100, so it resamples on the way in |
| length spread ≤ 1 s | pad the short ones with silence to the longest |
| length spread > 1 s | **reject**, showing all four durations — the numbers are the explanation |
| a file fails to decode | reject, naming **which file**, using §7's browser-naming message |
| partial set (2 of 4) | **refuse** — silence-filling makes "absent" and "muted" indistinguishable |
| one file where four are expected | **redirect, not error**: this looks like a single mixed track — separate it instead |

---

## 7. Failure surface

([11](issues/11-failure-surface.md)) Governing principle: **honesty over optimism, and refuse early
wherever the cost of finding out late is high.** The two guards in §3.1 and §3.2 are worth more than
all the wording below, because both sit in front of a nine-minute job.

### 7.1 Decode failure — name the browser, not the file

The failures are **browser-specific, not file-specific**: ALAC decodes only in Safari, Ogg only from
Safari 18.4+, Chrome's AAC is MP4-only and Main-Profile-only and absent from some Chromium builds.
So **"unsupported file" is actively false** — the file is usually fine, and the user's other browser
would probably open it. Saying it sends people off to re-encode something that did not need it.

> "Firefox couldn't decode this file. Its format isn't supported here — the same file may open in
> another browser, or you can convert it to WAV or FLAC, which work everywhere."

**No container sniffing.** The browser's own decoder is the only reliable oracle; a sniffer adds a
second, wrong opinion.

### 7.2 Storage — three situations, three treatments

- **Full, before a job** → refuse up front (§3.2).
- **Chrome's ~300 MB cap** → this is what you get when the browser is set to clear site data on
  close. It holds **1.6 songs**, so the library is broken by design and every second separation
  fails. Detect the small quota at startup and say **once** that it is a browser setting, where the
  setting lives, and that Gerson can hold about one song under it. **Report it as a browser setting,
  never as a storage error.** A `persist()` refusal folds into this same conversation.
- **Evicted, after the fact** → **one origin-level event, not N broken songs.** The honest detection
  is a **startup reconciliation** of catalogue rows against OPFS files. Reported once:
  *"Your browser cleared Gerson's stored audio. 6 songs need to be separated again."*
  **Reconciliation removes the rows — no tombstones, no re-separable stubs**, because invariant 1
  says a Song in the library plays. The Recording cannot rescue them; it was evicted too.

### 7.3 Model download interrupted

- **Not fatal, and must not be presented as fatal.** It blocks **separation only** — the existing
  library still plays, exports, and works offline. "Gerson failed to load" would be false and would
  scare people off an app that is at that moment almost entirely functional.
- **No resume.** Range requests and partial-file bookkeeping are real complexity for an 80 MB fetch.
  Retry from zero, **manually** — no silent auto-retry storm on a connection the user consented to
  use once.
- **Atomicity instead**: download to a temporary OPFS name, **verify before the rename** (length,
  and the SHA-256 pinned in the build), rename only on success. A truncated file that passes for a
  model is far worse than a failed download — it surfaces later as garbage output or a crash deep
  inside WASM, where nothing can attribute it.
- **Real byte progress** from `Content-Length`.
- **"Model present" is a three-valued app state** — `absent | downloading | ready` — read by the
  separation entry point, composing with §8's consent gate.

### 7.4 A failed Separation persists until dismissed

**Never auto-deleted.** A job that consumed nine minutes and vanished without trace is
indistinguishable from one never started, and the user's next move is to drop the same file and burn
nine more on the same failure. **The wreckage is the message.**

It holds the **cause, the timestamp, and the Recording** — so retry is one click, not "find that
file again". Two controls: **Retry** and **Dismiss** (deletes the Separation and its Recording).

Causes are **named, not generalised**, because they lead to different actions:

| cause | what it suggests |
|---|---|
| worker crash / out of memory | close other tabs or apps, then retry |
| storage write failure at the end | §7.2's storage conversation; retryable once space exists |
| **cancelled** | **not a failure — reads as cancelled**, never styled as an error |

---

## 8. PWA, offline, and the model lifecycle

([08](issues/08-pwa-offline-shell.md))

**"Offline" defined precisely**: after one shell load and one model fetch, **everything works with
the network off, including separation.** Before the model is fetched, everything except separation
works offline — **a real state the UI must represent, not an error.**

- **The model is fetched on first separation, with consent** — never eagerly. Nobody pays 80 MB for
  a capability they have not asked for.
- **The `.bin` is served from the app's own origin**, sitting next to the static build and
  **excluded from `vite-plugin-pwa`'s precache manifest**. One origin in the offline story, no CORS,
  no third-party uptime dependency. **The build pins its SHA-256** as a constant, which §7.3's
  verify-before-rename checks.
- **Once fetched, weights live in OPFS, not Cache Storage.** The reason is lifecycle, not speed: an
  80 MB artifact inside a precache manifest is one careless change away from re-downloading on every
  deploy. OPFS makes it **physically impossible** for an app update to purge the weights, rather
  than merely configured not to. It also keeps one storage system for all large binaries.
- **Bundling weights into the build is ruled out.**
- **Updates are offered, never forced — and suppressed entirely while a Separation is running or
  queued.** Reloading kills Workers, so a silent update would destroy nine minutes of work.
- Standard manifest and icons; installable on desktop.

---

## 9. The one mobile guard

Mobile is out of scope (§1). Exactly one piece of mobile handling ships, because it sits in front of
a job that is **known** to fail rather than merely at risk:

**A mobile user agent refuses separation up front and points at import** (§6.2). Peak RSS is ~2.3 GB
per worker against an iPhone WebContent limit of ~1.5 GB — that is a prediction, not a risk.
Accepted imperfection: Safari has no `navigator.deviceMemory`, so the signal is the user agent and
will over-refuse a capable tablet. Judged the better error.

**Not built**: iOS install onboarding, the 7-day-eviction acknowledgement, pinch-to-zoom and touch
hit-slop, and any responsive player layout. Mouse and keyboard only.

*(The set-from-playhead loop controls in §5.4 still ship — they were justified on precision, not on
touch.)*

---

## 10. UI surface

**Behaviour and state only. Claude Design owns the look.** This section says what must be
controllable and what must be displayed; it says nothing about how any of it appears.

### 10.1 Three surfaces

**Library** and **Player** are two full surfaces you navigate between, with a **persistent job
status affordance visible from both** — expandable to the full queue. This satisfies §3.6 (browse
and practise while a job runs, progress always visible) without the player permanently surrendering
horizontal width, which §5.1 established is what buys loop precision.

**Import role mapping** is a modal step over the Library, shown only for untagged sets.

### 10.2 Library

Displays: Songs newest-first (title, duration); Separations with status — queued with position,
running with true percentage and time estimate, interrupted, failed with its named cause and
timestamp.

Controls: drop or pick a file to separate; drop or pick a stem set to import; open a Song; rename a
Song; delete a Song (confirms, removes its OPFS files); reorder and cancel queued jobs; retry and
dismiss failed ones.

Origin-level notices live here: the small-quota browser setting, the eviction report, model download
state and consent, and the update-available offer.

### 10.3 Player

**Four stem rows**, each with: a waveform canvas, gain, mute, solo, and its Role name.

**A loop lane** above the rows, pixel-aligned with them, plus the overlay carrying the playhead and
the loop shading.

**Transport**, which must expose: play/pause; seek; tempo across 0.5×–2× with a numeric readout and
a reset-to-1× affordance; loop on/off; **loop start / end / length as a nudgeable numeric readout**;
**set loop start from playhead** and **set loop end from playhead**; zoom; the mono override; and
the two export commands.

Keyboard, because §5.4 makes set-from-playhead load-bearing:

| key | action |
|---|---|
| `space` | play / pause |
| `[` / `]` | set loop start / end from the playhead |
| `L` | toggle loop |
| `←` / `→` | nudge the focused loop readout |

Persisted on change: tempo, loop, per-stem gain and mute. Reset on open: solo, playhead.

### 10.4 Import mapping

Displays four files with their durations. Controls: a Role dropdown per file, prefilled only on an
unambiguous match and always visible as a prefill; confirm, which is disabled until all four Roles
are distinct and assigned. Rejections state their reason with the numbers (§6.2).

---

## 11. Build order

Four phases. Each ends somewhere usable.

**Phase 1 — pipeline and library.** Decode-first guard, content hash, storage pre-flight, OPFS +
IndexedDB layout, `demucs.cpp` WASM build and weight conversion, the worker pool, the job queue,
FLAC encode, peaks in the same pass, the Library surface. *Ends with: drop a song, wait nine
minutes, see it in the library.*

**Phase 2 — the player.** FLAC decode to transferable `Float32Array`, four stretcher nodes and the
three footguns, transport anchor and playhead maths, waveform rendering, loop lane, tempo, mono
override, memory policy. *Ends with: the actual product.*

**Phase 3 — export and import, as one unit.** Tagged FLAC stem export, mix export, the delivery
ladder, the zip path, then the import side that reads it. *Ends with: a library that can move.*

**Phase 4 — PWA and offline.** `vite-plugin-pwa`, manifest and icons, the model consent gate and
three-valued state, update-offered-not-forced with job suppression, startup reconciliation.
*Ends with: the offline claim being true.*

The failure surface (§7) is not a phase — each guard ships with the code path it guards.

---

## 12. Known limits, stated honestly

These belong in the product's own words, not just in this document.

- **Separation takes ~9 minutes for a 7-minute song** on a desktop with 8 workers, and pegs the CPU
  while it runs. Playback may stutter during a job.
- **A song costs ~93 MB of stems** plus the retained Recording. A 20-song library is ~1.87 GB.
- **Playback holds 78 MB per minute of song in memory** (39 MB mono) — 311 MB for a 4-minute song —
  and it cannot be reduced by streaming (§4.3).
- **Separation does not run on phones or tablets**, and mobile is not supported at all (§9).
- **Browsers can evict everything.** Gerson calls `persist()` and reports eviction honestly, but
  cannot prevent it. **Export is the backup.**
- **Separation quality is htdemucs' quality.** Some material separates well and some does not;
  Gerson makes no claim beyond what the model does.
- **The library never leaves the device.** Moving a song to another machine means exporting stems
  and importing them there.

---

## 13. Build-time gotchas

Collected so none of them is rediscovered at cost.

- **Vendor `demucs.cpp` at a pinned commit** — last pushed 2024-12-01. Do not track its default
  branch.
- **`signalsmith-stretch` ships no TypeScript types** (open upstream issue #26; the author asked for
  help). Budget a hand-written `.d.ts`.
- **The three `signalsmith-stretch` footguns** in §4.2. All three were paid for once already.
- **Never use freemusicdemixer's prebuilt weights** — proprietary. Only their code is MIT.
- **Confirm the WASM FLAC encoder writes Vorbis comments** at build time (§6.1). The import round
  trip depends on it.
- **Pin the model SHA-256 in the build** (§8), or §7.3's verification has nothing to check against.
- **Size the worker pool by RAM, not cores** (§3.3).
- **Pin every decode to an `OfflineAudioContext` at 44100** (§3.1), including on the import path.
