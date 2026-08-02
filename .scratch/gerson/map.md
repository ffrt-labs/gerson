# Map: Gerson — offline browser stem player

Label: `wayfinder:map`

## Destination

A build-ready spec for **Gerson**: a fully-offline, browser-only PWA where you upload a song,
split it into 4 stems, and practise against them (isolate, slow down, loop). The map is done
when nothing is left to decide — the spec is handed to a fresh build session, with the UI built
separately in Claude Design.

**Reached 2026-08-02.** [`spec.md`](spec.md) is written; every ticket is resolved or ruled out of
scope, and the fog is clear. The map is now a record of how the spec was arrived at, not a live
route.

## Notes

- **Domain**: browser audio (Web Audio API), on-device ML inference (WASM/WebGPU), PWA/offline storage.
- **Skills every session should consult**: `/grilling`, `/domain-modeling`. Use `/research` for
  `wayfinder:research` tickets and `/prototype` for `wayfinder:prototype` tickets.
- **Planning only.** No app code is written while working this map, with the single exception of
  throwaway prototypes created under a `prototype/` path to answer a design question.
- **Standing preference**: no server, ever. Any decision that reintroduces a backend is wrong for
  this effort.

### Settled at charting time (destination-shaping constraints, not tickets)

- Separation runs **in the browser** (WASM/WebGPU). No server component at all.
- **4 stems**: vocals / drums / bass / other. Guitar lives in "other".
- **Global tempo** control, all stems locked together, pitch preserved. A practice tool.
- Tempo is a **relative multiplier** (0.5x–2x), not an absolute BPM — there is no BPM detection.
- **Persistent local library** so the multi-minute split cost is paid once per song.
- In scope: upload → split → per-stem waveform, mute/solo/volume, transport, loop region, export stems.
- Stack: **Vite + React + TypeScript**, static build, `vite-plugin-pwa`.
- ~~Phone: installable PWA, playback-first. Splitting is best-effort. Library is per-device.~~
  **Revised 2026-08-02 while working 11: mobile is out of scope for this map — desktop web only.**
  Library is still per-device (sync needs a server). See Out of scope.

## Decisions so far

<!-- one line per resolved ticket: gist + link -->

- [Engine is pretrained Demucs, not moises-light](#) — `crlandsc/moises-light` ships architecture and
  training code only, no pretrained weights, and is 4-stem by design. Training a model is a different
  project. Gerson uses published pretrained Demucs artifacts instead.
- [01 — Which browser inference runtime and model artifact?](issues/01-browser-inference-runtime.md) —
  **`sevagh/demucs.cpp` compiled to WASM ourselves**, fanned across N Web Workers, GGML **f16
  `htdemucs` 4s (80.1 MB)** converted from Meta's own checkpoint. Deliberately single-threaded per
  worker, so **no SharedArrayBuffer and no COOP/COEP headers** — plain static hosting is fine.
  Progress is already emitted from C++ as a 0..1 value, which 07 gets for free. **Cost: ~9 min for a
  7-min song across 8 workers; ~2.3 GB peak RSS per worker**, and freemusicdemixer provisions one
  worker per 4 GB of RAM, forcing a single worker on mobile. Licence trap: freemusicdemixer's
  prebuilt weights are proprietary — only the code is MIT. Full findings:
  [research/01](research/01-browser-inference-runtime.md)
- [02 — Which time-stretch engine for pitch-preserved slow-down?](issues/02-time-stretch-engine.md) —
  **`signalsmith-stretch` 1.3.2 (MIT), four independent AudioWorklet nodes.** **Sync is not a
  problem**: the wrapper re-anchors absolutely every 128-frame quantum rather than accumulating, so
  error is ±0.5 sample and non-cumulative — simulated 10 min with 30 rate changes and an 8s loop at
  **0 samples of spread**. A single-stretcher architecture is *not* required, so per-stem gain stays
  trivially live. **One usage rule**: pass the schedule anchor explicitly, absolute, identical object
  to all four nodes (pass both `output` and `outputTime` — the README and the wrapper source
  disagree); omit it and you get 37ms steady spread and 8s of transient at every loop boundary.
  Ship `splitComputation: true` (worst-case quantum 10.5ms → 0.62ms against a 2.667ms budget) at a
  cost of 30ms latency. 0.5x–2x is exactly the algorithm's clean window. 47.6 kB gzip, inline WASM,
  no COOP/COEP. Rubber Band disqualified by **GPL-2.0** — a PWA ships its WASM.
  Full findings: [research/02](research/02-time-stretch-engine.md)
- [06 — Prototype: do 4 stretched stems stay in sync?](issues/06-playback-engine-prototype.md) —
  Built `prototype/playback-harness/` and ran it against the reference track separated with real
  `htdemucs`. **Sync is bit-identical** — 4 nodes, 120s, 30 rate changes, all pairs sample-identical
  (max|Δ| = 0), beating 02's simulated prediction. **Memory: 02's 339 MB was half — it is 622 MB**
  (decoded AudioBuffers *and* worklet copies both resident), but **`addBuffers` transfers**
  (verified: source detaches), so decode → transfer → drop the AudioBuffer gives 311 MB, ~40 MB
  windowed. Mono buffers unnecessary; windowing now optional. **Offline render works (~80x
  realtime), so 04's export-with-tempo ships.** Loop wrap clean across 5 positions and 3 rates.
  Two things could not be answered headlessly and moved to
  [14](issues/14-realtime-listening-session.md): 0.5x quality by ear, and all realtime behaviour.
  Full findings: [research/06](research/06-playback-engine-prototype.md)
- [08 — What does "works offline" actually mean?](issues/08-pwa-offline-shell.md) — **Model fetched on
  first separation with consent**, so it is never downloaded on a phone (07 refuses separation there
  anyway). **Weights in OPFS, not Cache Storage** — puts them physically beyond the service worker's
  cache rotation, so an app update cannot purge 80 MB. **iOS import proceeds after a one-time
  acknowledgement** of the 7-day eviction rule, with install instructions; a hard gate was rejected
  as too steep for a delayed, conditional risk. **Updates offered, never forced, and suppressed while
  a Separation runs** — a silent reload would kill nine minutes of work. Offline is defined precisely:
  after one shell load and one model fetch, everything works with the network off.
  Full reasoning: [research/08](research/08-pwa-offline-shell.md)
- [07 — How does a multi-minute separation job behave?](issues/07-separation-job-ux.md) — **App stays
  fully usable during a job**; the CPU contention that causes is stated in the UI rather than hidden.
  **One Separation at a time, the rest queue** — concurrency is pointless when worker count is
  memory-bound. **Interrupted jobs ask before restarting** (workers die with the page; resuming means
  starting over, and never silently commits nine minutes of CPU). **Cancel works everywhere.**
  **Mobile refuses up front** and points at import — accepted cost: no `deviceMemory` in Safari, so
  it will over-refuse a capable tablet. Progress is genuine, so shown as a true percentage.
  Full reasoning: [research/07](research/07-separation-job-ux.md)
- [05 — What is Gerson's domain model?](issues/05-domain-model.md) — Glossary in
  [`CONTEXT.md`](../../CONTEXT.md), schema in [research/05](research/05-domain-model.md).
  **Song** = one Recording + exactly four Stems (fixed Roles) + one Practice state. **A Separation
  is a separate noun**, not a Song with a status, so *if it is in the library as a Song, it plays* —
  a Song that cannot play is unrepresentable. **The Recording is kept** (~1% overhead; buys a
  reference mix and future re-separation). **Identity is a content hash**, shared by the Separation
  and the Song it becomes, so re-dropping a known file never costs nine minutes twice. Persisted:
  tempo, loop, gain, mute. Not persisted: solo, playhead.
- [14 — Listening session: 0.5x quality and realtime behaviour](issues/14-realtime-listening-session.md) —
  **0.5x passes by ear** on transient-dense material, so the **full 0.5x–2x range ships** and the
  make-or-break risk carried since 02 is closed. But **windowed streaming does not work**: feeding a
  stem in more than one `addBuffers` call breaks playback silently — digital silence (−180 dB), no
  exception, and it fails *before* the split point, so it is not a boundary bug. Reproduced in
  realtime (playhead froze at 30.3s) and isolated offline across four split configurations. Not
  upstream #22 (that throws). So **full-buffer only, memory floor 311 MB**; 06's ~40 MB windowed
  figure is unreachable, **mono playback is back on the table** as the only remaining lever, and
  mobile playback of long tracks becomes a live risk. Also found: **`input` in a schedule message is
  an absolute seek** — sending it on a tempo change teleports playback. Second API footgun after
  `outputTime`.
- [03 — How are stems stored on-device, and in what format?](issues/03-stem-storage.md) — **OPFS**
  (sync access handles in a Worker) for stem bytes + **IndexedDB** as the catalogue; stems stored
  **lossless FLAC** 16-bit/44.1k via a WASM codec used for both encode and decode. Lossy rejected on
  the merits: Opus has no native 44.1k mode, soloing removes the masking its bit allocation assumes,
  and 0.5x stretch smears pre-echo — exactly Gerson's operating point. Quota is not the binding
  constraint (20-song library ≈ 1.87GB); **iOS eviction is**, and installing to the Home Screen is
  the documented exemption. Full findings: [research/03](research/03-stem-storage.md)
- [04 — Which input formats decode, and what does export produce?](issues/04-audio-decode-and-export.md) —
  No static input list exists; the spec defers `decodeAudioData` to each browser's codec set, so
  **detection is "try the decode"**. Safe everywhere: MP3, AAC, FLAC, WAV. **Decode in an
  `OfflineAudioContext` pinned to 44100** or files silently round-trip 44.1→48→44.1 before Demucs
  sees them. Chunked decode **not needed** (10-min stereo = 212 MB). Native encode is a dead end —
  the cross-engine intersection is Opus alone, and WebKit source explicitly refuses FLAC and MP3 —
  so export rides the WASM FLAC codec 03 already pulls in, with WAV as the floor. **Export is two
  commands**: "Export stems" always 1× and ignoring mute/solo/volume; "Export mix" honours them,
  defaults to 1×, with an off-by-default apply-tempo checkbox. `showSaveFilePicker` is Chromium-only
  (not coming to Safari/Firefox); ladder down to `<a download>` then `navigator.share({files})`.
  Full findings: [research/04](research/04-audio-decode-and-export.md)

- [10 — How are four waveforms drawn and kept smooth?](issues/10-waveform-rendering.md) —
  **Zoomable, but one stored peaks resolution**: aggregate on the fly zooming out, stop at 1 pair/px
  (5.8ms) zooming in. Fit-the-song was rejected on a number — 0.2s per pixel is a sixteenth note of
  slop per loop edge with no grid to snap to. **Static viewport, sweeping playhead**, auto-follow
  only on exit and defeated by any interaction — this is what makes everything cheap: between
  gestures the waveforms are static bitmaps, so the 60fps bar applies to a line, not four waveforms.
  Continuous scroll rejected at **~53 MB** of offscreen bitmap on top of 14's 311 MB floor.
  **Four canvas 2D rows + one overlay canvas** (playhead and loop are song-level, per 05); WebGL buys
  nothing. **Peaks computed eagerly** in the same streaming pass and same commit as the stems, with
  recompute-from-FLAC as a repair path — so *a Song in the library implies its peaks exist*; 12
  inherits the rule for import. **Four rows only — the Recording is not a lane** (+78 MB and a
  Role-less pseudo-track); A/B, if ever, is a swap → note for 09. **Dedicated loop lane**, so
  click-on-waveform stays unambiguously seek; **nothing snaps** — precision comes from zoom,
  set-from-playhead, and a nudgeable numeric readout. **Playhead is main-thread arithmetic** from the
  transport anchor (confirms 02 §5), evaluated at **`currentTime − outputLatency`** and applying the
  worklet's **same loop wrap**. **One timeline everywhere**; on touch, precision — not memory — is
  what breaks (0.6 s/px vs a 40px fingertip), so **set-from-playhead is load-bearing on mobile, not a
  droppable extra**. **Main thread, no OffscreenCanvas**: blit the old bitmap during a gesture,
  re-render sharp on gesture end.

- [11 — What does the user see when things fail?](issues/11-failure-surface.md) — **Mobile went out
  of scope during this ticket**, which removed failure mode 1 outright and collapsed mode 5's bands
  into one desktop policy. Two guards carry more weight than all the wording, and both sit in front
  of the nine-minute job: **decode is the first step, so a bad file costs seconds** (no Separation is
  enqueued before its file decodes), and **`storage.estimate()` refuses up front** rather than
  failing the write at the *end* of a job. **Playback cost is exactly computable** — 78 MB/min stereo,
  39 mono — so policy runs on that, not on device introspection; desktop budget 2 GB (never fires in
  practice), warn-and-attempt above it, **mono always available as a manual override and implemented
  as a playback-time downmix, leaving 03's stereo FLAC untouched**. Load stems **sequentially** or
  06's double-residency spikes 4x. Decode errors **name the browser, not the file** — "unsupported
  file" is actively false when ALAC works only in Safari — and **no format list is ever advertised**.
  Chrome's ~300 MB cap is reported as **a browser setting, not a storage error**; eviction is **one
  origin-level event that removes rows, no tombstones** (05: if it is in the library, it plays). A
  failed model download is **not fatal — separation only**; no resume, but **verify-then-rename**,
  because a truncated model that passes for real fails later inside WASM where nothing can attribute
  it. A **failed Separation persists until dismissed** — the wreckage is the message, or the user
  burns another nine minutes on the same file — keeping cause, timestamp and Recording, with
  **cancelled reported as cancelled, never as an error**.

- [12 — How does importing an already-split stem set work?](issues/12-import-exported-stems.md) —
  Resolves 05's flagged tension: **import synthesises the Recording by summing the four stems**,
  chosen for **identity, not tidiness** — `id` hashes the Recording, so with none there is nothing to
  hash and re-import silently duplicates ~93 MB. The sum is deterministic, so the same files always
  yield the same id, and it is *true* (Demucs stems sum to the input). **Stems carry FLAC Vorbis
  comments** — role, song id, schema version, title — which **amends 04's bare-audio export**: a
  `manifest.json` was rejected because 04's non-Chromium path is four loose downloads. **The id
  travels, so a round-trip stays the same Song.** Filenames are never trusted for role. Untagged sets
  — including our own WAV exports — go through an **explicit four-dropdown mapping**; filenames may
  prefill only on an unambiguous four-distinct-role match, and **prefill is always visible and
  committed to**, since 14's failure was the guess being *invisible*, not wrong. Validation: rate
  mismatch is a non-issue (44100-pinned decode resamples), **length spread ≤1s pads, >1s rejects**
  with the durations shown, **partial sets refused** (silence-filling makes absent and muted
  indistinguishable), identity checked before any work. One drop zone, zip or loose files, **deflate
  supported** — and a zip is a container, not a promise. Provenance lands as
  **`recording.origin: "uploaded" | "summed"`** — on the Recording, not the Song, so 05's *a Song is
  a Song* holds and no "imported" badge appears; it exists because re-separating a sum-of-Demucs is a
  worse input, and calling a summed mix "Original" would be a lie.

- [09 — Write the build-ready spec](issues/09-write-the-spec.md) — **The destination.
  [`spec.md`](spec.md) is written**, folding all fourteen tickets into thirteen sections a fresh
  session can build from. Mostly folding, but six decisions nothing else owned were made in the
  writing: **A/B ruled a non-goal** (see Out of scope); **mobile keeps the guard and drops the UX** —
  07's refusal ships because it fronts a job known to die, while iOS onboarding, the eviction
  acknowledgement, and all touch precision are explicitly not built (10's set-from-playhead controls
  survive on *precision*, not touch); **four build phases** — pipeline+library → player →
  export+import as one unit → PWA/offline, with the failure surface deliberately not a phase, since
  each guard ships with the path it guards; **two surfaces plus a persistent job affordance**, which
  is what makes 07's usable-during-a-job real without the player losing the width 10 says buys loop
  precision; **weights served same-origin, precache-excluded, pinned by a build-time SHA-256** —
  08 settled where weights *land* but never where they are *fetched from*, and without the pinned
  hash 11's verify-before-rename had nothing to check; **export is FLAC by default on both commands**,
  resolving the drift between 04 (WAV) and 12's amendment (tagged FLAC), so the default path is also
  the path that round-trips.

## Not yet specified

<!-- in-scope fog: real, but not yet sharp enough to ticket -->

**The fog is clear. Nothing remains in scope that is not decided in [`spec.md`](spec.md).**

<!-- cleared by 14: subjective separation quality — judged by ear on real htdemucs stems and found
     good enough to practise against. The spec states it as a known limit rather than a claim:
     separation quality is htdemucs' quality, and Gerson makes no claim beyond it. -->
<!-- cleared by 09: session/UI state shape — absorbed into spec §10 as three surfaces (Library,
     Player, Import mapping), described as behaviour and state for the Claude Design handoff. -->
<!-- cleared by 09: reference-mix A/B — ruled a named non-goal. Moved to Out of scope below. -->

<!-- graduated: waveform rendering → 10; error surface → 11; import stems → 12 -->
<!-- cleared: Distribution — 01 and 02 both need no COOP/COEP, so plain static hosting is fine -->
<!-- cleared: First-run onboarding — folded into 08, which now carries the iOS install-first requirement -->
<!-- newly opened by 02: the 339MB four-buffer memory problem → folded into 06 -->
<!-- newly opened by 01: mobile separation is not viable, not merely best-effort → folded into 07 -->
<!-- newly opened by 01: weights must be self-converted from Meta's checkpoint → folded into 08 -->
<!-- newly opened by 03: iOS Home Screen install is the eviction exemption → folded into 08 -->
<!-- newly opened by 02: no TypeScript types for signalsmith-stretch; hand-written .d.ts → note for 09 -->
<!-- newly opened by 04: apply-tempo-on-export is viable only if the stretcher renders offline → check in 06 -->
<!-- newly opened by 02+03: 03 chose stereo FLAC; 02 argues memory pressure may force mono/windowed → 06 decides -->
<!-- newly opened by 04: five iOS device behaviours unverifiable by research → 13 -->
<!-- newly opened by 01: ORT-web switch condition is a 30-min timing test, prototype-shaped → note in 06 -->
<!-- newly opened by 01: demucs.cpp is 20 months stale; vendor at a pinned commit → note for 09 -->
<!-- newly opened by 10: peaks must be computed during import, in the decode-validation pass → 12 -->
<!-- newly opened by 10: touch loop precision depends on set-from-playhead controls → moot, mobile now out of scope.
     The set-from-playhead controls still ship: they are the precise way to place a loop by ear at any screen width. -->
<!-- 2026-08-02 mobile out of scope: 13 closed, 12 re-justified on non-phone grounds, 09 down to one blocker -->
<!-- newly opened by 11: model artifact needs a hash pinned in the build to verify before rename → note for 09 -->
<!-- newly opened by 12: 04 amended — stems export with FLAC Vorbis comments; confirm the WASM encoder writes them -->
<!-- 12 resolved: 09 is unblocked. The frontier is the spec itself. -->
<!-- 09 resolved 2026-08-02: spec.md written. The map is complete — no open tickets, no fog. -->
<!-- newly opened by 09: none. Six decisions nothing else owned were made in the writing; all six
     are recorded on 09 and folded into the spec. -->

## Out of scope

- **BPM and musical key detection** — ruled out at charting. A separate accuracy problem; tempo is a
  relative multiplier instead.
- **Smart metronome track** — depends entirely on beat detection, which is out of scope.
- **6-stem separation (guitar/piano)** — weaker quality, bigger and slower model. Guitar stays in "other".
- **Cross-device library sync** — requires a server. Violates the standing preference.
- **Mobile entirely — phones and tablets.** Ruled out 2026-08-02 while working 11: the target is a
  desktop web app, and mobile is not needed for a POC. This closed
  [13 — Verify five iOS behaviours on a real device](issues/13-ios-device-checks.md), which existed
  only to select iOS fallback paths and was **the only blocker on 09 that no agent could clear**
  (one item alone needed a week of wall-clock with a device in hand). Decisions already banked were
  **kept, not unwound** — 07's mobile refusal is one guard clause, and 08's OPFS weight storage is
  right on desktop regardless. Re-scoping mobile in later means a fresh effort, not a resumption.
- **Training or fine-tuning a separation model** — including anything built on `moises-light`.
- **Reference-mix A/B** — ruled out while working
  [09](issues/09-write-the-spec.md). 10 had ruled out a fifth waveform lane and sketched a swap
  instead (mute the four, play the Recording through the same transport); 09 declined to spec it. A
  fifth `signalsmith-stretch` node and buffer is **+78 MB against 14's unavoidable 311 MB floor**,
  and 12's summed Recordings mean "compare against the original" would sometimes be a lie. Practising
  against stems is the product; A/B is a mixing-desk affordance. Cheap to revisit later — the
  transport already exists — but as a fresh effort, not a resumption.
