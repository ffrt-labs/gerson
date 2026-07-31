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

Runs **in the browser** via WASM/WebGPU, using **pretrained Demucs** artifacts.

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

A **global** speed control, 0.5x–2x, **pitch preserved** (time-stretch, not playback-rate).

All stems are locked to the same clock. Independent per-stem tempo was considered and rejected —
stems drifting out of sync is a sound-design toy, not a practice tool.

Because there is no BPM detection, tempo is expressed as a **relative multiplier**, not an absolute
BPM number. The reference screenshot's "110" readout is out of scope.

### 3.4 Library and persistence

A **persistent on-device library** (OPFS/IndexedDB). Separation is paid once per song; reopening a
song is instant and works offline.

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
- **Mobile:** installable PWA, offline-capable, playback-first. Separation is **best-effort** — it
  may fail on larger files due to memory limits, and the app should say so honestly rather than
  hang. Importing previously-exported stems is the reliable mobile path.
- **UI design** is deliberately not specified here. The visual design is produced separately in
  Claude Design; this document and the eventual spec define *behaviour and state*, not appearance.
  The attached screenshot is a layout reference only.

## 4. Still open

These are tracked as tickets under `.scratch/gerson/issues/`. Each must be resolved before the
build-ready spec exists.

| # | Question | Type |
|---|---|---|
| 01 | Which browser inference runtime and model artifact? Speed, memory, licence, threading. | research |
| 02 | Which time-stretch engine? Quality at 0.5x, and can 4 instances stay in sync? | research |
| 03 | How are stems stored, in what format, and does the quota survive a real library? | research |
| 04 | Which input formats decode reliably, and what exactly does export produce? | research |
| 05 | The domain model and persisted schema. | grilling |
| 06 | Prototype: 4 stretched stems, sample-locked, with seek and loop. | prototype |
| 07 | How a multi-minute separation job behaves — progress, cancel, tab close, mobile failure. | grilling |
| 08 | What "offline" means for the app shell and for hundreds of MB of weights. | grilling |
| 09 | Write the build-ready spec. | blocked on all |

**Known unknowns not yet sharp enough to ticket:** waveform rendering strategy, the error/failure
surface, first-run onboarding, static hosting requirements (COOP/COEP headers), and importing
previously-exported stems.

## 5. Biggest risks

1. **Stem sync under time-stretch** (ticket 06). If four independently stretched streams drift, the
   core interaction breaks. This is prototyped early on purpose.
2. **Storage reality** (ticket 03). Four stems of a four-minute song is ~160MB uncompressed. A
   twenty-song library exceeds 3GB, which browsers will not reliably grant — the format decision may
   force lossy storage, which has its own quality cost when a stem is soloed and slowed.
3. **Mobile viability** (tickets 01, 07). The phone may not be able to separate at all. The design
   already accepts this; the risk is discovering it also can't comfortably *play* four stretched
   stems.
