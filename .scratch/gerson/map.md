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

## Not yet specified

<!-- in-scope fog: real, but not yet sharp enough to ticket -->

- **Waveform rendering strategy** — peak extraction, caching of peak data, canvas vs WebGL, keeping a
  playhead smooth at 60fps across 4 tracks. Can't be sharpened until the storage format (03) and the
  playback engine shape (06) are known.
- **Error and failure surface** — what the user sees when separation OOMs on mobile, when storage
  quota is exceeded, when an input file won't decode. Depends on 01, 03, 04, 07.
- **First-run onboarding** — the honest framing of "this downloads a large model and takes minutes".
  Sharpens once 01 and 08 fix the real numbers.
- **Distribution** — where the static build is hosted, whether HTTP headers (COOP/COEP) are available.
  Blocked on whether 01 concludes threaded WASM is required.
- **Import of previously-exported stems** — the reliable phone path implied by the phone-role decision.
  Needs the export format from 04 first.

## Out of scope

- **BPM and musical key detection** — ruled out at charting. A separate accuracy problem; tempo is a
  relative multiplier instead.
- **Smart metronome track** — depends entirely on beat detection, which is out of scope.
- **6-stem separation (guitar/piano)** — weaker quality, bigger and slower model. Guitar stays in "other".
- **Cross-device library sync** — requires a server. Violates the standing preference.
- **Training or fine-tuning a separation model** — including anything built on `moises-light`.
