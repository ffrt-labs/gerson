# 08 — Offline shell and weight caching

## Settled by research before this session

- **No COOP/COEP headers required** (tickets 01 and 02 both). Plain static hosting works, any host.
  The map's Distribution fog is closed by this.
- **The weights are 80.1 MB**, not the "hundreds of MB" the ticket assumed. A large download, not a
  prohibitive one.
- **Bundling the weights into the build is ruled out** — an 80 MB artifact in the precache manifest
  would be re-fetched on deploys and blocks first paint on nothing.
- **We host our own converted weights.** freemusicdemixer's prebuilt weights are proprietary (only
  their code is MIT), so the artifact is converted from Meta's `955717e8` checkpoint or taken from
  the MIT-tagged `Retrobear/demucs.cpp` dataset, then pinned somewhere stable.
- **`signalsmith-stretch` is 47.6 kB gzip with inline base64 WASM**, so the stretcher precaches with
  the shell for free and needs no special handling.

## Decisions

### The model is fetched on first separation, with consent

The app shell loads and is fully browsable without the model. The first time a user actually starts a
separation, Gerson states that this needs a one-off 80 MB download and fetches it with their
agreement.

Rationale: nobody pays 80 MB for a capability they have not asked for. This also composes with ticket
07's mobile refusal — on a phone, separation is declined outright, so **the model is never fetched on
mobile at all**. An eager fetch would have burned 80 MB of someone's cellular data for a feature that
device cannot use.

An interrupted model download resumes or restarts on the next attempt; it is not partially usable, so
there is no half-installed state to represent.

### Weights live in OPFS, next to the stems

Not Cache Storage, and the reason is the update lifecycle rather than performance.

`vite-plugin-pwa` maintains a precache manifest and cleans up superseded caches on activation. An
80 MB artifact inside that mechanism is one careless manifest change away from being re-downloaded on
every deploy. Putting it in OPFS **decouples the weights from the service worker entirely** — an app
update physically cannot purge them, rather than merely being configured not to.

Secondary benefits: one storage system for all large binary data (consistent with ticket 03), and the
inference Worker can read it through sync access handles, which is where it is consumed anyway.

### iOS: import proceeds after a one-time acknowledgement

WebKit deletes script-writable storage after 7 idle days, and Home Screen web apps are explicitly
exempt ("ITP always skips that domain"). So on iOS, installing is what makes a library persist.

Gerson explains this plainly before the first import on an uninstalled iOS browser, shows how to add
to the Home Screen, and proceeds once acknowledged.

**A hard gate was considered and rejected.** It would be consistent with ticket 07's outright refusal
of mobile separation, but the cases genuinely differ: separation on iOS *will* fail, whereas storage
is lost only after seven unused days. Blocking a stranger from trying Gerson on their phone is too
steep a price for a delayed, conditional risk — particularly since the exposure is limited to
imported stems (separation being refused on mobile anyway), and recovering means re-transferring
files from desktop rather than re-running inference.

`navigator.storage.persist()` is still requested where supported, as a second line of defence.

### Updates are offered, never forced

A new version surfaces as a quiet affordance the user takes when convenient. Never `skipWaiting`,
never an automatic reload.

The decisive reason is Gerson-specific: **reloading kills a running separation**, because Workers die
with the page (ticket 07). A silent update would destroy nine minutes of work with no warning. The
update prompt is therefore **suppressed entirely while a Separation is running or queued**, and
offered once the queue drains.

Weights are unaffected by updates by construction, since they live outside the service worker's
cache.

## What "works offline" means, precisely

After the shell has loaded once **and** the model has been fetched once, with the network off:

| capability | works offline |
|---|---|
| open the app, cold start, installed or not | yes |
| browse the library, open a Song | yes |
| play, tempo, loop, mute/solo | yes |
| separate a new song | yes — the model is local |
| import a stem set | yes |
| export stems | yes |
| receive an app update | no, obviously |

If the model has **not** been fetched, everything except separation still works offline. That is a
real state the UI must represent, not an error.

## Deliberately not decided here

- The wording of the model-download consent, the iOS acknowledgement, and the update affordance →
  **ticket 11**, which owns user-facing language.
- Where these prompts physically appear → Claude Design.
- Which host serves the app and the pinned weights → a deployment choice, unconstrained now that no
  special headers are needed.
