# Map: Gerson — offline browser stem player

Label: `wayfinder:map`

## Destination

A build-ready spec for **Gerson**: a fully-offline, browser-only PWA where you upload a song,
split it into 4 stems, and practise against them (isolate, slow down, loop). The map is done
when nothing is left to decide — the spec is handed to a fresh build session, with the UI built
separately in Claude Design.

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
- Phone: installable PWA, playback-first. Splitting is best-effort. Library is per-device.

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

## Not yet specified

<!-- in-scope fog: real, but not yet sharp enough to ticket -->

- **Subjective separation quality** — whether htdemucs' four stems are actually good enough to
  practise against on the material the user cares about. No amount of research answers this; it needs
  ears on a real song, and it only becomes checkable once 06 can play stems back.
- **Session/UI state shape for the Claude Design handoff** — 05 settled the persisted schema, so what
  remains is the *screen* inventory and which controls each surface exposes. Sharpens once 10, 11 and
  12 have named the screens they imply; likely folds into 09 rather than becoming its own ticket.

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

## Out of scope

- **BPM and musical key detection** — ruled out at charting. A separate accuracy problem; tempo is a
  relative multiplier instead.
- **Smart metronome track** — depends entirely on beat detection, which is out of scope.
- **6-stem separation (guitar/piano)** — weaker quality, bigger and slower model. Guitar stays in "other".
- **Cross-device library sync** — requires a server. Violates the standing preference.
- **Training or fine-tuning a separation model** — including anything built on `moises-light`.
