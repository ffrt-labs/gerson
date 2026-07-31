# Research 03 — On-device stem storage: API, format, quota

Ticket: `.scratch/gerson/issues/03-stem-storage.md`
Date: 2026-07-31

**Headline:** store stems as **FLAC files in OPFS**, one file per stem, with an IndexedDB record
per song as the catalogue. **Do not store stems lossily.** Quota is *not* the binding constraint on
either desktop Chrome or an installed iOS PWA — eviction is, and installing to the Home Screen plus
`navigator.storage.persist()` removes that risk.

---

## 0. Baseline arithmetic (used throughout)

44.1 kHz, stereo, 16-bit PCM = `44100 x 2 ch x 2 B` = **176,400 B/s** = 10.58 MB/min.

| Thing | 4-min (240 s) stem | 4 stems (1 song) | 20-song library |
|---|---|---|---|
| 16-bit WAV @44.1k stereo | 42.34 MB | 169.3 MB | 3.39 GB |
| 24-bit WAV | 63.50 MB | 254.0 MB | 5.08 GB |
| FLAC @ 55% of PCM | 23.3 MB | 93.1 MB | 1.86 GB |
| FLAC @ 45% of PCM (sparse stems) | 19.1 MB | 76.2 MB | 1.52 GB |
| Opus 128 kbps VBR | 3.84 MB | 15.4 MB | 307 MB |
| Opus 96 kbps VBR | 2.88 MB | 11.5 MB | 230 MB |

Decoded-in-RAM cost is format-independent and much larger than people expect:
a 240 s stereo 44.1 kHz `AudioBuffer` is Float32 → `240 x 44100 x 2 x 4` = **84.67 MB per stem**,
**338.7 MB for all four**. That is a playback-engine problem (ticket 06), but it is the reason
compressing storage does *not* rescue mobile memory — it only rescues disk.

**Number not found:** a first-party FLAC compression ratio. Xiph removed its lossless-codec
comparison page ("this comparison has been removed",
https://xiph.org/flac/comparison.html) and the FAQ only says bitrate can range "from around 100% of
the input rate (if you are encoding noise), down to almost 0 (encoding silence)"
(https://xiph.org/flac/faq.html). The 45–55% band above is a planning assumption, not a cited fact —
measure it on real Demucs output before committing UI copy to a number.

---

## 1. OPFS vs IndexedDB

### Browser support (MDN browser-compat-data, `main`)

| Feature | Chrome | Chrome Android | Safari / iOS | Firefox | Firefox Android |
|---|---|---|---|---|---|
| OPFS (`navigator.storage.getDirectory`) | 86 | 86 | 15.2 | 111 | 111 |
| `FileSystemFileHandle.createSyncAccessHandle` | 102 | **109** | 15.2 | 111 | 111 |
| `StorageManager.persist()` / `persisted()` | 55 | 55 | 15.2 | 57 | 57 |
| `StorageManager.estimate()` | 61 | 61 | **17** | 57 | 57 |
| WebCodecs `AudioEncoder` | 94 | 94 | **26** | 130 | **not supported** |

Sources:
- https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/FileSystemFileHandle.json
- https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/StorageManager.json
- https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/AudioEncoder.json
- MDN calls OPFS "Baseline Widely available … since March 2023":
  https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system

OPFS is available on every target Gerson has, including iOS 15.2+. That is older than the iOS 17
storage-policy floor we need anyway (see §2), so OPFS is not the limiting factor.

**Caveat:** WebKit states OPFS is **unavailable in Safari Private Browsing**
(https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/).
Gerson must degrade to "session only, nothing saved" in private mode rather than crash.

### Read/seek behaviour — the decisive difference

`FileSystemSyncAccessHandle` (Workers only) gives positional `read(buffer, { at })` /
`write(buffer, { at })` into a **caller-allocated** `DataView`, plus `getSize()`, `truncate()`,
`flush()`, `close()`
(https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).
That means:

- You can read a stem in fixed chunks into a pre-allocated buffer, so peak RSS during load is
  `AudioBuffer size + one chunk`, not `AudioBuffer size + whole file`.
- You can build the waveform-peaks file in a single streaming pass at import time without ever
  materialising the whole PCM array twice.
- The file is also reachable as a `File` via `fileHandle.getFile()`, so the same bytes can be handed
  to `<audio>` / `MediaElementAudioSourceNode` via `URL.createObjectURL` with no copy — useful as a
  low-memory playback fallback on phones.

IndexedDB has no equivalent. Values are structured-cloned records; to get chunked reads you must
manually shard each stem into N records and key them, reimplementing a file. MDN's own comparison
frames it exactly this way — OPFS is "file-based, byte-level access … sequential/random file seek",
IndexedDB is "key-value object storage … query-based retrieval" (same MDN page).

The WebKit implementation note that matters operationally: "the attempt to create a second
`FileSystemSyncAccessHandle` on an entry will fail, if the previous … is not closed properly"
(https://webkit.org/blog/12257/...). Every handle must be closed in a `finally`, or the stem becomes
unreadable until the page reloads. Treat this as a hard code rule.

### Throughput

**Not found.** Neither MDN, web.dev
(https://web.dev/articles/origin-private-file-system) nor the WebKit OPFS post publishes MB/s
figures for OPFS or IndexedDB. web.dev only asserts OPFS is "optimized for performance" and that
sync handles are "faster … as they avoid having to deal with promises". Do not put a throughput
number in the spec; benchmark on the target devices during build.

The structural argument stands regardless of the missing benchmark: OPFS sync writes are a
worker-thread `write(view, {at})` into an already-open file handle, whereas an IndexedDB put is a
transaction with structured clone plus commit. For 170 MB per song written once, OPFS is the right
shape.

### Verdict

**OPFS for stem audio and peaks. IndexedDB for the catalogue record.** Do not put multi-megabyte
blobs in IndexedDB. Do not put queryable metadata in OPFS — you would be hand-rolling an index.

---

## 2. Quota

### What each platform grants

**Chrome / Chromium:** "an origin can store up to 60% of the total disk size in both persistent and
best-effort modes"
(https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
Google's own guide agrees — "An origin can use up to 60% of the total disk space" — and adds that
incognito drops to roughly 5%, and that with "Clear cookies and site data when you close all
windows" enabled the cap falls to about **300 MB**
(https://web.dev/articles/storage-for-the-web). That 300 MB case would hold **one and a half songs**
of FLAC stems; Gerson must detect it via `estimate()` and say so plainly rather than failing on song
two.

**Safari 17+ / iOS 17+:** per-origin quota "up to 60% of total disk space" for browser apps, 15% for
embedded WebViews, and an overall cross-origin ceiling of 80% (browser) / 20% (non-browser)
(https://webkit.org/blog/14403/updates-to-storage-policy/). Critically for Gerson: "Web apps
installed to home screen receive browser-level quotas rather than the reduced limits for regular
embedded content" (same post). Safari 17.0 release notes confirm the pre-17 world is gone:
"Previously, an origin had a starting storage limit of 1 GB … Now, the origin quota is calculated
based on total disk space" (https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).

⚠️ **Stale-source warning:** web.dev/articles/storage-for-the-web still describes Safari as
"approximately 1GB before prompting users … in 200MB increments". That text predates Safari 17 and
is contradicted by both WebKit posts above. Ignore it; the WebKit blog is authoritative.

**Firefox:** best-effort is the smaller of 10% of disk or a 10 GiB group limit; persistent is 50% of
disk capped at 8 TiB and exempt from the group limit (MDN quota page). Not a Gerson target but worth
noting that Firefox is the one engine where 10 GiB is a real ceiling.

### Worked quota check

| Device | Total disk | Nominal origin quota | 20-song FLAC library (1.86 GB) |
|---|---|---|---|
| Desktop, 512 GB SSD | 512 GB | ~307 GB (60%) | 0.6% of quota — fine |
| iPhone, 128 GB | 128 GB | ~76.8 GB (60%) | 2.4% of quota — fine |
| iPhone, 64 GB, 6 GB free | 64 GB | ~38 GB nominal | quota says yes, **free space says maybe** |
| Chrome with "clear on close" | any | ~300 MB | **1.6 songs** — must be detected |

Even the uncompressed 3.39 GB WAV library clears the nominal quota everywhere except the 300 MB
Chrome case. **Quota is not the reason to compress.** The real limit on a phone is actual free disk,
which the quota number does not reflect — MDN is explicit that `estimate()` "only returns the
estimated usage value, not the actual value" and that browsers pad cross-origin sizes.

### Querying it

`navigator.storage.estimate()` → `{ usage, quota }`. Safari only from **17** — on iOS 15.2–16 you
have OPFS but no `estimate()`, so feature-detect and fall back to "unknown, try it and catch".

### Does `persist()` help?

Yes, materially, and more on Safari than on Chrome.

- MDN: persistent data "is only evicted … if the user chooses to"; the LRU eviction mechanism
  "skips over origins that have been granted data persistence".
- WebKit 17.0: "An origin is exempt from eviction when its storage mode is persistent", and
  "Critical bugs have been fixed to ensure the storage mode value is remembered across sessions"
  (https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).
- Grant behaviour: Chrome, Edge and Safari "automatically approve or deny the request based on the
  user's history of interaction with the site and do not show any prompts"; Firefox shows a UI popup
  (MDN quota page). For WebKit the documented heuristic includes **whether the site is running as a
  Home Screen Web App**.

So: call `persist()`, but treat a granted result as a bonus, not a guarantee.

### The iOS finding that actually matters

Separate from quota, WebKit's tracking-prevention policy deletes storage on a timer:
"ITP deletes all cookies created in JavaScript and all other script-writeable storage after 7 days
of no user interaction with the website." **But**: "The first-party domain of home screen web
applications is exempt from ITP's 7-day cap on all script-writeable storage, i.e. ITP always skips
that domain in its website data removal algorithm." (https://webkit.org/tracking-prevention/)

Translation for Gerson: **on iOS, a library that lives in the Safari tab can evaporate after 7 idle
days; a library in the installed Home Screen app does not.** Since a split costs minutes of on-device
inference, this is not a nicety — first-run on iOS should push installation before the user imports
anything, and the UI should say why.

MDN also notes eviction is all-or-nothing: "When an origin's data is evicted by the browser, all of
its data, not parts of it, is deleted at the same time." There is no partial-library failure mode to
design for; it is everything or nothing.

---

## 3. Format: WAV vs FLAC vs Opus — and the lossy call

### The call

**Store lossless. Opus is the wrong choice for Gerson's stored stems.** Recommended format:
**FLAC, 16-bit, 44.1 kHz, stereo, compression level 5**, with a per-song gain scalar in metadata.

Six reasons, strongest first:

1. **Compression buys nothing we need.** §2 shows even the 3.39 GB uncompressed library fits inside
   the nominal quota on every target. Accepting permanent quality loss to solve a problem we do not
   have is a bad trade.
2. **Opus has no 44.1 kHz mode.** RFC 6716: "The MDCT layer always operates internally at a sample
   rate of 48 kHz", with supported rates of 8/12/16/24/48 kHz
   (https://datatracker.ietf.org/doc/html/rfc6716). Storing 44.1 kHz stems as Opus forces a resample
   on encode and another on the way back. That desynchronises stems from the original file's
   timeline and makes sample-exact loop points — a core feature of a practice tool — needlessly
   fiddly.
3. **Soloing defeats the codec's core assumption.** Perceptual codecs allocate bits against a masking
   model derived from the *whole* signal. Gerson's headline feature is removing the rest of the mix.
   A soloed bass or a soloed vocal in a quiet bar is precisely the signal where the coding noise that
   was supposed to be masked is left standing on its own.
4. **0.5x stretching is the worst-case operating point.** A phase-vocoder/WSOLA stretch smears
   short-time content across time. Codec pre-echo and the codec's short-window noise floor get
   smeared with it, which is heard as warble and metallic pre-ring — at exactly the tempo the user
   picks when they are trying to hear detail.
5. **Artifact confusion.** Demucs output already carries separation artifacts (bleed, spectral
   holes). Layering a second, unrelated artifact class on top makes it impossible for the user — or
   for us, debugging — to tell whether an odd sound came from the model or the codec.
6. **Irreversibility.** Lossless storage keeps every export option in ticket 04 open. Lossy storage
   bakes the loss in permanently, and the only way back is re-running a multi-minute separation.

**The honest counterweight:** Xiph's own guidance puts Opus at "96–128 kbps" for music storage and
calls **128 kbps VBR** "pretty much transparent" for stereo music
(https://wiki.xiph.org/Opus_Recommended_Settings). For a full mix on speakers that is true and the
listening tests back it (Opus beat LC-AAC/Vorbis/MP3 at 96 kbps,
https://opus-codec.org/comparison/). None of those tests were run on isolated stems at half speed.
So: keep Opus as an **opt-in "compact library" escape hatch** for genuinely space-constrained
devices (and as a sensible default for the phone-transfer/export path in ticket 04, where 96 kbps is
fine), never as the default stored format.

### Why FLAC over WAV

| | 16-bit WAV | FLAC L5 | Opus 128k |
|---|---|---|---|
| 20-song library | 3.39 GB | ~1.86 GB | 307 MB |
| Lossless | yes | yes | no |
| Native 44.1 kHz | yes | yes | **no** |
| Encoder needed | **none** (44-byte RIFF header) | WASM (~200 KB) | WebCodecs or WASM + muxer |
| Decoder needed | none (read PCM directly) | WASM (or `decodeAudioData`, see below) | container-dependent |
| Random seek in file | trivial (fixed byte/sample) | frame-index needed | container-dependent |

WAV's real advantage is that it needs **zero** codec code in either direction — you write an RIFF
header and Int16 samples, and to load you `read(view, { at })` a byte range and convert. FLAC costs
one WASM dependency and buys ~1.5 GB back across 20 songs, plus cheap decode by design: FLAC "is
optimized for decoding speed at the expense of encoding speed, because it makes it easier to decode
on low-powered hardware" (https://xiph.org/flac/faq.html).

Take FLAC, on one condition: **decode through the same WASM library, not `decodeAudioData`.** Chrome
has shipped FLAC for `<audio>` and Web Audio for years, but I could **not find** a primary WebKit
source confirming FLAC support in Safari's `decodeAudioData`, and Safari's track record with
non-Apple codecs in that specific API is poor — WebM-Opus in `decodeAudioData` was broken across
Safari 15 and 16 (bugs.webkit.org 226922, 238546, 245428) and MP4-Opus in `decodeAudioData` was only
fixed in Safari Technology Preview 240, March 2026
(https://webkit.org/blog/17896/release-notes-for-safari-technology-preview-240/). Doing FLAC decode
in WASM makes behaviour identical on every browser and removes an entire class of platform bug from
the roadmap. It also gives us the encoder we need for export (ticket 04) from the same dependency.

**Fallback:** if FLAC encoding measures at more than ~5% of the separation wall-clock time on the
target devices, ship 16-bit WAV instead and keep a `schemaVersion` field so a later migration is
possible. Do not let the format decision block the build.

### Bit depth and clipping

Demucs emits float32 and individual stems can exceed ±1.0 even when the mix does not. Do not clip on
the way to 16-bit. Compute **one** scale factor across all four stems of a song
(`s = 1 / max(peak over all stems)`, only applied when that peak > 1.0), store `s` in the song
record, and multiply it back in as a gain node at playback. One shared factor keeps the four stems
summing correctly to the original mix. 16-bit gives ~96 dB of dynamic range, which is far beyond what
a practice tool needs; 24-bit costs 50% more disk for no audible return here.

---

## 4. Encoding path — what can actually encode in-browser

**WebCodecs `AudioEncoder`** is available in Chrome 94+ / Chrome Android 94+, Firefox 130+ desktop
(`version_added: false` on Firefox Android), and **Safari 26+** — Safari 26.0 "adds AudioEncoder and
AudioDecoder" to WebCodecs (https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).

But the codec matrix kills it for our purposes. Chromium's `audio_encoder.cc` handles **exactly two
codecs — Opus and AAC** — and "explicitly shows no support for MP3, FLAC, PCM, µ-law, or A-law";
anything else returns "Unsupported codec type"
(https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webcodecs/audio_encoder.cc).
Chromium's Opus config limits: sample rate 8000–48000, at most 2 channels, frame duration a multiple
of 2500 µs in [2500, 120000]. AAC: 44100 or 48000 Hz only.

So:
- **WAV** — no encoder at all. Hand-write the RIFF header. Works everywhere, including Firefox
  Android.
- **FLAC** — **WASM only.** No browser exposes a FLAC encoder through WebCodecs. `libflac.js` /
  equivalent, run in the same worker that owns the OPFS sync access handles.
- **Opus** — WebCodecs on Chrome and Safari 26+, WASM `libopus` elsewhere, *plus* an Ogg or WebM
  muxer, since `AudioEncoder` emits raw `EncodedAudioChunk`s and not a playable file. This is the
  most work of the three, for the option we are rejecting.
- **AAC** — available via WebCodecs on Chrome/Safari but not Firefox, patent-encumbered, and lossy.
  No reason to pick it.

Overlap with ticket 04 (export): the FLAC WASM dependency chosen here should be the one 04 uses for
lossless export, and WAV export needs nothing at all. If 04 wants a small "share to phone" format,
that is where WebCodecs Opus earns its keep — encode on demand, never store.

---

## 5. Eviction and cleanup — what the app must do

1. **Ask for persistence early.** Call `navigator.storage.persist()` on first import (not on first
   load — a user with no data is less likely to be granted it), and surface `persisted()` state in a
   storage settings panel.
2. **On iOS, push installation before the first split.** The 7-day ITP deletion applies to the Safari
   tab; the Home Screen web app is exempt (https://webkit.org/tracking-prevention/). Say this in
   plain language: "Add Gerson to your Home Screen, or iOS may delete your library after a week
   unused."
3. **Pre-flight every import with `estimate()`.** Project the output size from the decoded duration
   (`duration_s x 176400 x 4 x expected_flac_ratio`) and refuse to start a multi-minute separation
   whose result will not fit. Refuse when `usage + projected > quota * 0.8`. Feature-detect
   `estimate()` — absent below Safari 17.
4. **Catch `QuotaExceededError` on every write.** In Chrome 138+ the error is a real
   `QuotaExceededError` interface carrying `quota` and `requested` in bytes
   (https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/QuotaExceededError.json);
   Firefox and Safari still throw a plain `DOMException`, so match on `e.name === "QuotaExceededError"`
   and read the extra properties only when present.
5. **Commit order: files first, record last.** Write all four stems and the peaks to
   `/songs/<id>/`, `flush()` and `close()` every handle, then write the IndexedDB record. The
   IndexedDB record is the sole definition of "this song is complete".
6. **Reconcile on every startup.** Walk the OPFS `songs/` directory and the IndexedDB `songs` store:
   - record present, files missing → mark the song broken; offer re-split or delete.
   - files present, no record → orphan from an interrupted or failed import; delete.
   Eviction is all-or-nothing per origin (MDN), so the common case is *both* sides empty at once —
   handle "library is unexpectedly empty" as a first-class state with an explanation, not as a
   fresh install.
7. **Always close sync access handles in `finally`.** A leaked handle makes that stem unopenable
   (WebKit: a second handle on the same entry fails while the first is open).
8. **Give the user the controls.** Per-song delete, total library size from `estimate()`, and an
   optional "delete original uploads, keep stems" sweep.
9. **Private browsing:** OPFS is unavailable in Safari Private Browsing. Detect and run in an
   explicit ephemeral mode.

---

## 6. Recommended storage layout

### OPFS

```
/songs/<songId>/
    vocals.flac        stem audio, 16-bit 44.1k stereo
    drums.flac
    bass.flac
    other.flac
    vocals.peaks       Int8 min/max pairs, 1 pair per 256 samples
    drums.peaks
    bass.peaks
    other.peaks
    original.<ext>     optional, as uploaded; deletable without breaking the song
/tmp/<importId>/       in-progress import scratch; swept on startup
```

### IndexedDB — database `gerson`, store `songs` (keyPath `id`)

```ts
{
  id: string,              // uuid, also the OPFS directory name
  schemaVersion: 1,
  title: string,
  artist?: string,
  durationSec: number,
  sampleRate: 44100,
  channels: 2,
  createdAt: number,
  separatedWith: { model: string, version: string },
  gainScalar: number,      // per-song, see §3; 1.0 unless a stem peaked over 1.0
  codec: "flac" | "wav",
  bitDepth: 16,
  peaks: { samplesPerPixel: 256, encoding: "int8-minmax" },
  stems: [                 // exactly 4: vocals, drums, bass, other
    { name: "vocals", path: "songs/<id>/vocals.flac", bytes: number,
      peaksPath: "songs/<id>/vocals.peaks", peaksBytes: number }
  ],
  originalFile?: { path: string, bytes: number, mimeType: string }
}
```

A second store `settings` holds `persistGranted`, `lastReconcileAt`, and the user's
compact-library preference. Nothing large ever goes in IndexedDB.

### Worked example — one 4-minute song, FLAC at 55%

| Item | Size |
|---|---|
| 4 x stem FLAC (23.3 MB each) | 93.1 MB |
| 4 x peaks (41,344 Int8 min/max pairs = 82.7 KB each) | 331 KB |
| IndexedDB record | < 2 KB |
| original.mp3 (320 kbps, optional) | 9.6 MB |
| **Total, original kept** | **~103 MB** |
| **Total, original discarded** | **~93.4 MB** |

### Worked example — 20-song library (avg 4 min)

| Format | Stems | Peaks | Total (no originals) | Total (+ 320 kbps originals) |
|---|---|---|---|---|
| FLAC @55% | 1.86 GB | 6.6 MB | **1.87 GB** | 2.06 GB |
| FLAC @45% | 1.52 GB | 6.6 MB | 1.53 GB | 1.72 GB |
| 16-bit WAV | 3.39 GB | 6.6 MB | 3.40 GB | 3.59 GB |
| Opus 128k (rejected) | 307 MB | 6.6 MB | 314 MB | 506 MB |

Against a 60%-of-disk quota this is 1.9 GB out of ~307 GB on a 512 GB desktop and out of ~76.8 GB on
a 128 GB iPhone. Comfortable. The only configuration where it fails is Chrome with
"clear cookies and site data when you close all windows" (~300 MB), which must be detected via
`estimate()` and explained.

---

## 7. Open items handed to other tickets

- **Ticket 04 (export):** reuse the FLAC WASM dependency chosen here. WebCodecs Opus at 96 kbps is
  the right *export/transfer* format even though it is the wrong *storage* format.
- **Ticket 06 (playback):** 338.7 MB of Float32 `AudioBuffer` for four 4-minute stems is the binding
  memory constraint on iOS, and storage format does not change it. The OPFS `getFile()` →
  `URL.createObjectURL` → `MediaElementAudioSourceNode` path is the low-memory alternative, at the
  cost of losing direct buffer access for time-stretching.
- **Waveform rendering (map "Not yet specified"):** peaks format is fixed above — Int8 min/max pairs
  at 256 samples/pixel, one file per stem in OPFS, 82.7 KB per stem for 4 minutes.
- **Benchmark before building:** OPFS write throughput (no published numbers exist), real FLAC ratio
  on Demucs stems, and FLAC WASM encode time as a fraction of separation time.

---

## Sources

- MDN, Storage quotas and eviction criteria — https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN, Origin private file system — https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- MDN, AudioEncoder — https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder
- MDN, QuotaExceededError — https://developer.mozilla.org/en-US/docs/Web/API/QuotaExceededError
- MDN browser-compat-data (`main`): `api/FileSystemFileHandle.json`, `api/StorageManager.json`, `api/AudioEncoder.json`, `api/QuotaExceededError.json`
- WebKit, Updates to Storage Policy — https://webkit.org/blog/14403/updates-to-storage-policy/
- WebKit, Features in Safari 17.0 — https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
- WebKit, Features in Safari 26.0 — https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- WebKit, Safari Technology Preview 240 release notes — https://webkit.org/blog/17896/release-notes-for-safari-technology-preview-240/
- WebKit, The File System API with Origin Private File System — https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/
- WebKit, Tracking Prevention Policy — https://webkit.org/tracking-prevention/
- Chromium source, `audio_encoder.cc` — https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webcodecs/audio_encoder.cc
- web.dev, Storage for the web — https://web.dev/articles/storage-for-the-web (Safari section stale, see §2)
- web.dev, The origin private file system — https://web.dev/articles/origin-private-file-system
- IETF RFC 6716 (Opus) — https://datatracker.ietf.org/doc/html/rfc6716
- Xiph, Opus Recommended Settings — https://wiki.xiph.org/Opus_Recommended_Settings
- Xiph, Opus comparison / listening tests — https://opus-codec.org/comparison/
- Xiph, FLAC FAQ — https://xiph.org/flac/faq.html
- WebKit bugs 226922, 238546, 245428 (WebM/Opus in `decodeAudioData`) — https://bugs.webkit.org/
