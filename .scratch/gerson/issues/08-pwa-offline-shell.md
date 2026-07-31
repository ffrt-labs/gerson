# 08 — What does "works offline" actually mean for the shell and the weights?

Type: grilling
Status: resolved
Blocked by: 01

## Question

The app shell is small; the model weights are not. Offline-first has to account for both.

Walk:

- **Weight caching**: where do the model files live — Cache Storage via the service worker, OPFS
  alongside the stems, or bundled into the build? Bundling hundreds of MB into a static build is
  almost certainly wrong; confirm and rule it out explicitly.
- **First run**: is the model downloaded eagerly on first load, or lazily on first separation?
  What does the user see while several hundred MB arrive, and what happens if it's interrupted?
- **Offline definition**: after first successful load + model download, does *every* feature work
  with the network off — including a cold start of an installed PWA? That is the claim; verify what
  would break it.
- **Updates**: how does a new app version reach an installed PWA, and does a version bump invalidate
  the cached weights? (It must not, unless the model itself changed.)
- **Install**: manifest, icons, and what the installed experience is on desktop vs iOS.

## Sharpened by research

- **Install-before-import is a hard requirement on iOS**, not a suggestion. 03 found that WebKit
  deletes script-writable storage after 7 idle days, and that Home Screen web apps are explicitly
  exempt ("ITP always skips that domain"). Since a split costs ~9 minutes, an uninstalled iOS user
  can silently lose the whole library. Design the onboarding that pushes install *before* the first
  import, and decide how insistent it is.
- **The weights are 80.1 MB, not "hundreds of MB"** (01). That materially softens the first-run
  question — it is a large download, not a prohibitive one. Bundling into the build is still likely
  wrong; confirm and rule it out explicitly.
- **We must convert the weights ourselves** from Meta's `955717e8` checkpoint, or source the
  MIT-tagged `Retrobear/demucs.cpp` HF dataset. freemusicdemixer's prebuilt weights are
  **proprietary** — only their code is MIT. Decide where our converted artifact is hosted and pinned,
  since the offline story depends on it being fetchable exactly once.
- **No COOP/COEP needed** (01 and 02 both). Plain static hosting works — the Distribution question is
  closed, and any host will do.
- The stretcher is 47.6 kB gzip with **inline base64 WASM**, so it precaches with the shell for free.

## Answer

Full reasoning: [research/08](../research/08-pwa-offline-shell.md).

- **The 80 MB model is fetched on first separation, with consent** — not eagerly. Nobody pays for a
  capability they have not asked for, and since 07 refuses separation on mobile, **the model is never
  fetched on a phone at all**. An eager fetch would have spent 80 MB of cellular data on a feature
  that device cannot use.
- **Weights live in OPFS, not Cache Storage.** The reason is lifecycle, not speed: an 80 MB artifact
  inside `vite-plugin-pwa`'s precache manifest is one careless change away from re-downloading on
  every deploy. OPFS makes it **physically impossible** for an app update to purge the weights,
  rather than merely configured not to. Also keeps one storage system for all large binaries (03).
- **iOS import proceeds after a one-time acknowledgement.** WebKit evicts after 7 idle days and Home
  Screen apps are exempt, so the user is told plainly and shown how to install, then allowed through.
  A hard gate was considered and rejected: unlike mobile separation, which *will* fail, this risk is
  delayed and conditional, the exposure is limited to imported stems, and recovery is a re-transfer
  rather than re-running inference. `storage.persist()` requested as a second line of defence.
- **Updates are offered, never forced**, and **suppressed entirely while a Separation is running or
  queued** — reloading kills Workers, so a silent update would destroy nine minutes of work.
- **"Offline" defined precisely**: after one shell load and one model fetch, everything works with
  the network off, including separation. Before the model is fetched, everything except separation
  works offline — a real state the UI must represent, not an error.

Confirmed from research and not re-litigated: no COOP/COEP headers needed (so any static host);
bundling weights ruled out; we host our own weights converted from Meta's checkpoint, because
freemusicdemixer's prebuilt weights are proprietary.

Passed to **ticket 11**: wording of the download consent, the iOS acknowledgement, and the update
affordance.

