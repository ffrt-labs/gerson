# Gerson — Product Requirements

**Status:** charting complete, decisions in progress. This document records what has been decided
and what is still open. It is *not yet* the build-ready spec — that is produced by working the map
at `.scratch/gerson/map.md` and lands at `.scratch/gerson/spec.md`.

Last updated: 2026-07-31

---

## 1. What Gerson is

A practice tool for musicians. You give it a song; it splits the recording into four isolated
instrument tracks and lets you play them back independently — mute the guitar and play along, solo
the bass to learn a line, slow a hard passage to half speed without it turning into a chipmunk, and
loop that passage until it's yours.

It runs entirely in the browser, entirely on your machine. Nothing is uploaded anywhere. After the
first load it works with the network off.

## 2. Why it's built this way

Three constraints drive nearly every decision below:

1. **No server, ever.** Not a cost decision — a scope decision. There is no account system, no
   upload, no backend to operate. Any design that reintroduces a backend is wrong for this project.
2. **Separation is expensive.** Running a neural separation model in a browser tab costs minutes of
   CPU and hundreds of megabytes of model weights. The product has to be honest about that rather
   than hide it behind a spinner.
3. **Desktop-first, phone-capable.** Primary use is at a desk with an instrument. The phone should
   install and play, but can't be assumed to have the memory to separate.

## 3. Decided

### 3.1 Separation engine

Runs **in the browser** via WASM, using **pretrained Demucs** artifacts: `sevagh/demucs.cpp`
compiled to WASM ourselves and fanned across N Web Workers, with the GGML f16 `htdemucs` 4-stem
model (80.1 MB) converted from Meta's own `955717e8` checkpoint.

No COOP/COEP headers are required, so plain static hosting works anywhere.

**Be honest about the cost:** roughly **9 minutes for a 7-minute song across 8 workers** on desktop.
WebGPU is not currently a faster path for this model (10–15 min measured, vs 20–30 min on WASM in
the ONNX runtime). Peak memory is ~2.3 GB per worker, so worker count is memory-bound at roughly one
per 4 GB of RAM.

**Licence trap:** freemusicdemixer's prebuilt weights are proprietary — only its code is MIT. Gerson
converts from Meta's checkpoint or uses the MIT-tagged `Retrobear/demucs.cpp` dataset.

**Rejected: `crlandsc/moises-light`.** It was the original candidate, but it ships architecture and
training code only — no pretrained weights. Adopting it would mean training a source-separation
model on MUSDB18-class data first, which is a different project with a different budget. It is also
4-stem by architecture, so it offers no advantage over Demucs on stem coverage.

### 3.2 Stems

Four: **vocals, drums, bass, other**.

Guitar was requested but is not its own stem — it lands in "other". 6-stem separation
(`htdemucs_6s`) does expose guitar and piano, but at meaningfully worse quality with audible bleed,
a larger download, and slower inference. Not worth it for a practice tool where the four core stems
have to be reliable.

### 3.3 Tempo

A **global** speed control, 0.5x–2x, **pitch preserved** (time-stretch, not playback-rate), via
**`signalsmith-stretch` (MIT)** as four independent AudioWorklet nodes. 0.5x–2x is exactly that
algorithm's clean window.

Sync between the four nodes is a solved problem: the wrapper re-anchors absolutely every 128-frame
quantum instead of accumulating position, so error is ±0.5 sample and non-cumulative — provided all
four nodes are given the same absolute schedule anchor object.

Rubber Band was the quality runner-up but is disqualified by **GPL-2.0**: a PWA ships its WASM to
the client, which would make Gerson GPL.

All stems are locked to the same clock. Independent per-stem tempo was considered and rejected —
stems drifting out of sync is a sound-design toy, not a practice tool.

Because there is no BPM detection, tempo is expressed as a **relative multiplier**, not an absolute
BPM number. The reference screenshot's "110" readout is out of scope.

### 3.4 Library and persistence

A **persistent on-device library**: **OPFS** (sync access handles in a Worker) for stem bytes, with
**IndexedDB** as the catalogue. Stems are stored **lossless FLAC** 16-bit/44.1 kHz via a WASM codec
used for both encode and decode. Separation is paid once per song; reopening is instant and offline.

Lossy storage was considered and rejected on the merits, not by reflex: Opus has no native 44.1 kHz
mode, soloing a stem removes the masking its bit allocation assumes, and 0.5x stretching smears
codec pre-echo — which is to say, both of Gerson's headline features attack exactly the assumptions
lossy encoding relies on. A 20-song lossless library is ~1.87 GB, comfortably inside quota, so the
saving would buy nothing.

The library is **per-device**. With no server, the phone cannot see the desktop's library. The
supported path for moving a song between devices is export → import.

### 3.5 Feature scope

**In:**

- Upload a local audio file
- Split into 4 stems
- Per-stem waveform display
- Per-stem mute, solo, volume
- Transport: play/pause, seek, playhead
- Global tempo (0.5x–2x, pitch preserved)
- Loop region — drag a region on the timeline and repeat it
- Export stems to disk

**Out (deliberately):**

- BPM detection and musical key detection
- Smart metronome / click track (depends on beat detection)
- 6-stem separation (guitar, piano)
- Cross-device sync (requires a server)
- Training or fine-tuning any separation model

### 3.6 Platform

- **Stack:** Vite + React + TypeScript, static build, `vite-plugin-pwa`.
- **Desktop:** the primary target. Full functionality including separation.
- **Mobile:** installable PWA, offline-capable, **playback-only in practice**. Research hardened this
  from the original "best-effort": ~2.3 GB peak per worker against an iPhone WebContent limit of
  ~1.5 GB means separation is *expected to fail*, not merely at risk. Gerson should detect this and
  decline up front rather than OOM ten minutes in. **Importing previously-exported stems is the
  supported mobile path**, which promotes import from a convenience to a core feature.
- **iOS install is load-bearing.** WebKit deletes script-writable storage after 7 idle days, and
  Home Screen web apps are explicitly exempt. Since a split costs ~9 minutes, an uninstalled iOS user
  can silently lose their whole library — so onboarding must push install before the first import.
- **UI design** is deliberately not specified here. The visual design is produced separately in
  Claude Design; this document and the eventual spec define *behaviour and state*, not appearance.
  The attached screenshot is a layout reference only.

## 4. Still open

These are tracked as tickets under `.scratch/gerson/issues/`. Each must be resolved before the
build-ready spec exists.

Tickets 01–04 (all research) are **resolved**; their conclusions are folded into section 3 above and
their full findings live in `.scratch/gerson/research/`. Remaining:

| # | Question | Type | Blocked by |
|---|---|---|---|
| 05 | The domain model and persisted schema. | grilling | — |
| 06 | Prototype: memory, and 0.5x quality by ear. | prototype | — |
| 07 | Separation job behaviour — progress, cancel, tab close, mobile refusal. | grilling | — |
| 08 | Offline shell, weight hosting, iOS install-first onboarding. | grilling | — |
| 10 | Waveform rendering architecture and loop-drag interaction. | grilling | 06 |
| 11 | What the user sees when things fail. | grilling | 07 |
| 12 | Importing an already-split stem set — the mobile path. | grilling | 05 |
| 13 | Verify five iOS behaviours on a real device. | task | — |
| 09 | Write the build-ready spec. | — | all of the above |

**Known unknowns not yet sharp enough to ticket:** subjective separation quality on real material
(needs ears, not research), and the session/UI state shape handed to Claude Design.

**Closed by research:** static hosting needs no COOP/COEP headers — any host will do.

## 5. Biggest risks

Reordered after research. Two of the original three are resolved; the survivor got worse.

1. **Playback memory** (ticket 06). The stretcher only works in buffer mode, so each of the four
   nodes owns its stem's PCM — **339 MB resident for a 4-minute song**, regardless of storage
   format. Compressing storage does not help this. It is a phone-tab-kill risk and may force mono
   playback buffers or windowed loading.
2. **Time-stretch quality at 0.5x, by ear** (ticket 06). 0.5x sits inside the algorithm's clean
   window, but the library's own README recommends 0.75x–1.5x and it has **no transient detector**,
   so drums at half speed are the specific worry. This is the make-or-break for the headline
   feature and no amount of further research answers it.
3. **Nine minutes per song** (ticket 07). Not a technical risk but a product one: whether the wait
   is tolerable is a question about how the job is presented, not about the model.

~~Stem sync under time-stretch~~ — resolved by ticket 02: non-cumulative, 0 samples of spread.
~~Storage quota~~ — resolved by ticket 03: not the binding constraint. iOS *eviction* was the real
issue, and Home Screen install is the documented fix.
