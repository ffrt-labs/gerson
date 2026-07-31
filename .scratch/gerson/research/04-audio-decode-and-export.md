# 04 — Audio decode and export

Research findings for wayfinder ticket `04-audio-decode-and-export`.
Researched 2026-07-31. Every non-obvious claim is cited. Where a fact could not be established
from a primary source it says **not found** rather than guessing.

Overlap note: ticket 03 (stem storage) faces the same encoder question. This document establishes
the **encoder capability matrix** (section 4) because export depends on it; it deliberately does
not analyse OPFS/IndexedDB/quota, which is 03's territory.

---

## 1. Input: what `decodeAudioData` actually accepts

### 1.1 The spec does not define a format list

`BaseAudioContext.decodeAudioData()` delegates entirely to the host's media stack. The Web Audio
spec says the input "can be in any of the formats supported by the `audio` element", determined by
MIME sniffing, and that only the **first** audio track of a multi-track byte stream is decoded
([W3C Web Audio API 1.1, `decodeAudioData`](https://www.w3.org/TR/webaudio-1.1/)).

Consequence: **the supported-format set is exactly the browser's `<audio>` codec set**, and it is
not knowable statically. Feature detection must be done by attempting a decode, not by extension.

Two behaviours from the same spec text that bite in practice:

- **The input `ArrayBuffer` is detached.** The spec explicitly detaches `audioData` when the call
  is queued ([spec](https://www.w3.org/TR/webaudio-1.1/)). Any code holding that buffer (e.g. to
  retry a decode, or to also hash the file) loses it. Copy first if you need it twice.
- **The result is resampled to the context's sample rate**, not the file's
  ([MDN `decodeAudioData`](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)).
  Since Demucs artifacts are 44.1 kHz, decode inside a context pinned to 44100 —
  `new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes)` — rather than the default
  `AudioContext`, whose rate follows the output device (commonly 48000). Otherwise every file gets
  a silent 44.1→48→44.1 double resample before it reaches the model.

### 1.2 Per-format support, per browser

Sources: MDN's codec guide
([Audio codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs),
[Containers](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers)).

| Input | Chrome / Edge | Firefox | Safari desktop | Mobile Safari |
|---|---|---|---|---|
| **MP3** (`.mp3`) | Yes | Yes (direct since 71; OS-backed before) | Yes (3.1+) | Yes |
| **AAC in MP4/M4A** (`.m4a`) | Yes — **MP4 container only, Main Profile only, and absent from Chromium (open-source) builds** | Yes, **only if the OS media framework provides AAC** | Yes | Yes |
| **AAC in ADTS** (`.aac`) | Yes | OS-dependent | Yes | Yes |
| **FLAC** (`.flac`) | Yes | 51 desktop / 58 Android | 11+ | Yes (iOS 11+) |
| **WAV / LPCM** (`.wav`) | de-facto yes | Yes (LPCM only; ADPCM / GSM / µ-law / MP3-in-WAV are **No**) | de-facto yes | de-facto yes |
| **Ogg Vorbis** (`.ogg`) | 4+ | 3.5+ | **Only 18.4+** | **Only iOS 18.4+** |
| **Ogg Opus** (`.opus`) | 33+ | 15+ | **Only 18.4+** (before that: Opus only inside a CAF file) | **Only iOS 18.4+** |
| **WebM/Opus** | Yes | Yes | Yes | Yes |
| **ALAC in M4A** | **No** | **No** | Yes | Yes |
| **AIFF** | not found | not found | de-facto yes | de-facto yes |

Caveats that matter, with sources:

- **Safari gained Ogg only recently.** "Safari 18.4+ (on macOS 15.4+, iOS 18.4+, iPadOS 18.4+, and
  visionOS 2.4+) added support for Opus and Vorbis codecs in Ogg containers"
  ([MDN Containers, Ogg section](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers#ogg)).
  Before that Safari could not play `.ogg`/`.opus` at all; MDN's codec page still carries the older
  "CAF only" note for Opus in Safari. Any user on iOS 17 or earlier cannot import an Ogg file.
- **Safari is the only engine that decodes ALAC** — Chrome/Firefox/Edge are all "No"
  ([MDN Audio codecs, ALAC](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs#alac_apple_lossless_audio_codec)).
  Users with iTunes-ripped `.m4a` libraries will hit this: the same file imports on a Mac and fails
  on the same user's Windows Chrome.
- **Chrome's AAC is not universal.** "Chrome supports AAC only in MP4 containers, and only supports
  AAC's Main Profile. In addition, AAC is not available in Chromium builds"
  ([MDN Audio codecs, AAC](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs#aac_advanced_audio_coding)).
  Firefox likewise "relies upon a platform's native support for AAC" (same page) — a Linux Firefox
  without the relevant system codecs will fail on `.m4a`.
- **WAV is under-documented.** MDN's container index table has **no WAV row**, and its
  "Audio codecs supported by WAVE" table has values only for Firefox (LPCM = Yes; ADPCM, GSM 06.10,
  MP3-in-WAV, µ-law all = No) — the Chrome/Edge/Safari cells are blank
  ([MDN Containers, WAVE section](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers#wave_wav)).
  So **a primary-source per-browser WAV table was not found.** Supporting evidence that Safari
  handles it: WebKit's MIME registry maps `.wav` to `audio/x-wav` / `audio/vnd.wave`
  ([`MIMETypeRegistry.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/MIMETypeRegistry.cpp)),
  and WebKit's WebCodecs decoder accepts `pcm-*` codec strings
  ([`AudioDecoderCocoa.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/AudioDecoderCocoa.cpp)).
  Treat plain 16/24-bit LPCM WAV as universal, but verify empirically in the smoke test.

### 1.3 Practical rule for Gerson

Accept `audio/*` plus a wide extension allowlist in the file input, attempt the decode, and surface
a specific failure ("this browser cannot decode Apple Lossless — re-export as WAV or FLAC")
rather than a generic error. The formats that decode **everywhere Gerson targets** are: **MP3,
AAC-in-MP4 (except Chromium builds / codec-less Linux Firefox), FLAC, and WAV/LPCM.** Ogg is
desktop-safe but iOS ≤ 17-hostile; ALAC is Apple-only.

---

## 2. Memory cost of decoding, and whether chunked decode is needed

### 2.1 The arithmetic

`AudioBuffer` is specified as "non-interleaved IEEE754 32-bit linear PCM"; `getChannelData()` hands
back a `Float32Array` per channel
([MDN `AudioBuffer`](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer)).
So decoded size is exactly `4 bytes × channels × sampleRate × seconds`, independent of the input
codec or file size:

| Content @ 44.1 kHz stereo | Decoded float32 |
|---|---|
| 1 minute | 21.2 MB |
| 4-minute song | 84.7 MB |
| 10-minute track | **211.7 MB** |
| 4 stems of a 4-min song | 338.8 MB |
| **4 stems of a 10-min track** | **846.7 MB** |

(48 kHz is ~8.8% larger again. A 10-min stereo track at 48 kHz float32 is 230.4 MB.)

The compressed source bytes are a rounding error next to this (a 10-min 320 kbps MP3 is 24 MB), and
they are freed anyway when `decodeAudioData` detaches the buffer.

### 2.2 The ceiling on mobile Safari

WebKit engineer Ben Nham, on
[WebKit bug 268816](https://bugs.webkit.org/show_bug.cgi?id=268816) (comment 10):

- iPhone WebContent process limit: **1.5 GB** ("although if the system is not under memory pressure,
  the process may be able to exceed this limit").
- iPad: higher and device-dependent — "for an 8GB device, the limit will be in the 4GB+ range".
- Separately, the JSC **Gigacage caps typed-array and WebAssembly allocations at 2 GB on iOS**, and
  has done "for several years"; it is not straightforwardly raisable "due to VA space layout
  reasons". This is the binding constraint for the WASM inference heap (ticket 01) more than for
  decode, but both compete inside the same 1.5 GB process budget on iPhone.

Exceeding the process limit is a jetsam kill — the tab reloads, with no catchable JS error.

### 2.3 Verdict: chunked decode is **not** needed; chunked *pipeline* is

A one-shot `decodeAudioData` of a 10-minute track peaks at ~212 MB of decoded audio plus the
decoder's own working set. On desktop that is unremarkable. On an iPhone it is ~14% of the 1.5 GB
budget — survivable **on its own**.

The thing that actually blows the budget is what comes after: four stems resident simultaneously is
847 MB for that same 10-minute track, on top of the source buffer and the model weights. **Input
decode is not the bottleneck, and a chunked decoder would not fix the bottleneck.** Building a
WebCodecs decode path to save 212 MB while the stem set costs 847 MB is optimising the wrong term.

Reasons not to build the WebCodecs path for v1, beyond it not helping:

- **It requires a demuxer.** WebCodecs' own explainer lists "Direct APIs for media containers
  (muxers/demuxers)" under **Non-goals**
  ([w3c/webcodecs explainer](https://github.com/w3c/webcodecs/blob/main/explainer.md#non-goals)).
  `AudioDecoder` takes `EncodedAudioChunk`s that *you* must extract from the MP4/MP3/Ogg yourself —
  i.e. shipping mp4box.js plus an MP3 frame parser plus an Ogg page parser.
- **`AudioDecoder` is absent on the platform that needs it most.** Per MDN BCD: Chrome 94, Firefox
  130, **Safari 26** (Sept 2025), Safari iOS mirrors → **iOS 26**; Firefox for Android is `false`
  ([`AudioDecoder` compat data](https://github.com/mdn/browser-compat-data/blob/main/api/AudioDecoder.json),
  [MDN `AudioDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder)).
  Safari 26.0 "expands support for the WebCodecs API by adding `AudioEncoder` and `AudioDecoder`"
  ([WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
  So on iOS 18/17 — the weakest devices, the ones that actually OOM — there is no chunked path at all.

**Recommendation.** One-shot `decodeAudioData` into a 44.1 kHz `OfflineAudioContext` is the single
decode path. Manage memory by (a) writing each stem to storage and dropping its `AudioBuffer` as
soon as separation emits it, (b) storing stems as int16 rather than float32 where 03 allows —
halves resident cost — and (c) length-gating on mobile: compute
`4 × channels × rate × duration` up front and refuse/warn above a threshold (~6 min on iPhone gives
~509 MB of stems, which leaves room; 10 min does not). Revisit WebCodecs chunked decode only if
profiling shows the source buffer specifically is the thing that kills the tab.

---

## 3. Encoding in-browser: what is actually possible

Two independent routes: **WebCodecs `AudioEncoder`** (native, free, but codec support is thin and
it emits raw chunks with no container), or a **WASM encoder** (universal, costs download size and
CPU).

### 3.1 WebCodecs `AudioEncoder` availability

Per MDN BCD
([`AudioEncoder`](https://github.com/mdn/browser-compat-data/blob/main/api/AudioEncoder.json)):

| | Chrome/Edge | Firefox desktop | Firefox Android | Safari | Safari iOS |
|---|---|---|---|---|---|
| `AudioEncoder` | 94 | 130 | **never (`false`)** | **26** | **26** |

Secure context required; available in dedicated workers
([MDN `AudioEncoder`](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder)).

### 3.2 Which codecs each engine will actually *encode*

The registry defines codec strings `flac`, `mp3`, `mp4a.*`, `opus`, `vorbis`, `ulaw`, `alaw`,
`pcm-*` ([W3C WebCodecs Codec Registry](https://www.w3.org/TR/webcodecs-codec-registry/)) — but
registration is not implementation. From engine source:

**Chrome / Edge — Opus and AAC only.**
`VerifyCodecSupportStatic` in
[`audio_encoder.cc`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webcodecs/audio_encoder.cc)
switches on `kOpus` and `kAAC` and falls through to `"Unsupported codec type."` for everything else.
Additional constraints in that file: Opus is capped at 2 channels ("Our Opus implementation only
supports up to 2 channels"); AAC only if `MojoAudioEncoder::IsSupported(kAAC)` — i.e. platform
AAC — and restricted to 1/2/6 channels and 44100/48000 Hz, with bitrate limited to
{96k,128k,160k,192k} on Windows. **No FLAC, no MP3, no PCM encoding.**

**Firefox — Opus and Vorbis only.**
`IsSupportedAudioCodec` in
[`dom/media/webcodecs/AudioEncoder.cpp`](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webcodecs/AudioEncoder.cpp)
is literally `aCodec.EqualsLiteral("opus") || aCodec.EqualsLiteral("vorbis")`. Not on Android at all.

**Safari 26 — Opus, AAC, PCM, A-law/µ-law; explicitly *not* FLAC, MP3 or Vorbis.**
WebKit's `WebCodecsAudioEncoder.cpp` allowlists a wide set, but the Cocoa backend then rejects
three of them outright in `InternalAudioEncoderCocoa::checkConfiguration`
([`AudioEncoderCocoa.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/audio/cocoa/AudioEncoderCocoa.cpp)):

```cpp
if (internalConfig.codec == 'vorb')                       return makeUnexpected("Vorbis encoding is not supported"_s);
if (internalConfig.codec == kAudioFormatFLAC)             return makeUnexpected("FLAC encoding is not supported"_s);
if (internalConfig.codec == kAudioFormatMPEGLayer3)       return makeUnexpected("MP3 encoding is not supported"_s);
```

Same file: Opus is capped at 2 channels, **and `Opus Ogg format is unsupported`** — Safari will only
emit raw Opus packets, never an Ogg bitstream. AAC in ADTS is likewise rejected.

**The intersection across all three engines is exactly one codec: Opus.** FLAC and MP3 encoding are
available through WebCodecs in **no** shipping browser.

### 3.3 What that leaves for export formats

| Format | How | Cost / verdict |
|---|---|---|
| **WAV (16-bit LPCM)** | ~40 lines of JS: RIFF header + `Int16` conversion of `getChannelData()` | Zero dependencies, works in every browser, no WebCodecs needed. 10.6 MB/min stereo. **The guaranteed path.** |
| **WAV (32-bit float)** | same | 21.2 MB/min. Only if bit-exactness with the model output matters; DAWs accept it, consumer players often don't. |
| **FLAC** | **WASM only** (libFLAC compiled to WASM). Not encodable via WebCodecs anywhere (§3.2). | ~50–60% of WAV size, lossless, decodes in every target browser (§1.2). Costs a WASM download. Worth it **only if 03 already pulls libFLAC in for storage** — then export is free. |
| **Opus** | WebCodecs where present (Chrome 94+/FF 130+/Safari 26+), else WASM libopus | Needs a **JS muxer** — WebCodecs emits bare chunks (§2.3 non-goals), and Safari refuses to produce Ogg. So: write an Ogg/WebM packer, or ship WASM anyway. Plus it is lossy on material that will be soloed and time-stretched — see 03. |
| **AAC / M4A** | Chrome (platform-dependent, absent in Chromium) + Safari 26; **not Firefox** | Not portable. Rules itself out. |
| **MP3** | WASM LAME only | Encodable in no browser natively. Only justified if "must open in any music player on any device" beats everything, and WAV already satisfies that. |

**Recommendation: WAV 16-bit for v1**, with FLAC as a later opt-in that reuses whatever encoder
ticket 03 lands. Do not build an Opus export path for v1 — it is the only WebCodecs-portable codec
but it needs a muxer, it is lossy, and it buys nothing WAV/FLAC don't.

---

## 4. The design call: what does "export" produce?

### 4.1 Recommendation

**Two commands, not one.**

1. **"Export stems" (primary, the default button).** Writes the four separated stems —
   vocals / drums / bass / other — as four files. **Always at 1×. Always ignoring mute, solo and
   per-stem volume.** No loop-region trimming; the whole song.
2. **"Export mix" (secondary).** Renders one file through an `OfflineAudioContext` that **does**
   respect the current mute/solo/volume state, and the loop region if one is set.
   **Defaults to 1×**, with an explicit, off-by-default "apply current tempo (0.5×–2×)" checkbox.

### 4.2 Why

- **The two commands answer genuinely different questions, and collapsing them silently corrupts
  one of them.** "Export stems" answers *"get this out of the browser"* — into a DAW, onto a laptop,
  or, per the map's "Import of previously-exported stems" fog item, back into Gerson on a phone that
  cannot run the separation itself. That artifact must be a faithful copy of what the model emitted.
  If mute/solo/volume leaked into it, exporting while soloing drums would silently write three
  silent files, and the round-trip re-import path would import a mix state rather than stems.
- **Tempo is a view setting, not a property of the audio.** Nothing else in Gerson's UI is
  destructive; the loop region, the solo state and the tempo multiplier are all things you can undo
  by dragging a control. Baking a 0.7× stretch into a file is the one action that cannot be undone,
  and it is the one most likely to be an accident ("I was practising slowly, then I hit export").
  Default off.
- **But the slow-practice-track want is real**, and it is the whole point of the app. A guitarist who
  wants the chorus at 0.7× on a phone music player during a commute is asking for exactly the
  destructive thing. That want is *always* about the audible mix, never about four raw stems — so
  attaching the tempo option to "Export mix" only, as an explicit checkbox, serves it without
  contaminating the interop artifact.
- **Loop region follows the same logic.** It is meaningful for a practice mix ("just the solo, slow")
  and meaningless-to-harmful for stems.

### 4.3 The one hard dependency — flag it for ticket 02

Rendering a **tempo-adjusted** mix offline requires the time-stretch engine to run inside an
`OfflineAudioContext`. That works if the stretcher is an `AudioWorkletProcessor` (offline rendering
executes the full graph, worklets included) or a pure buffer-in/buffer-out WASM call. It does **not**
work if the chosen engine is realtime-only or driven by a `MediaElementAudioSourceNode` — those
cannot be rendered faster than realtime.

Note also that `AudioBufferSourceNode.playbackRate` is **not** an option here: it changes pitch,
which the map rules out ("pitch preserved").

**Therefore:** if ticket 02 lands a worklet/WASM stretcher, ship the tempo checkbox. If it lands a
realtime-only engine, **drop tempo from export entirely for v1** and say so in the UI — do not fall
back to rendering in realtime, which would mean a 4-minute export taking 5.7 minutes at 0.7×.

### 4.4 Rendering the mix

`OfflineAudioContext(channels, lengthInSampleFrames, sampleRate)` → build the same graph the live
player uses (four `AudioBufferSourceNode`s → four `GainNode`s → destination), copy the current gain
values in, `startRendering()`. Output is an `AudioBuffer`; serialise with the same WAV writer as the
stems. Peak memory is the four source buffers **plus** the rendered result — for a 4-minute song
that is 339 + 85 = 424 MB, which is the largest single moment in the whole app on mobile. Render the
mix from stems streamed off storage one at a time if the platform is iOS.

---

## 5. Delivery: getting bytes onto disk

### 5.1 `showSaveFilePicker` — Chromium only, and that is not changing soon

Per MDN BCD
([`Window.showSaveFilePicker`](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json)):

| | Chrome | Chrome Android | Edge | Firefox | Safari | Safari iOS |
|---|---|---|---|---|---|---|
| `showSaveFilePicker` | 86 | **132** | 86 | **No** | **No** | **No** |
| `showOpenFilePicker` | 86 | 132 | 86 | No | No | No |
| `showDirectoryPicker` | 86 | 132 | 86 | No | No | No |

MDN marks it "Limited availability / Experimental", requiring a secure context **and transient user
activation** — it must be called synchronously from a click handler, so you cannot `await` your
encode first and then open the picker
([MDN `showSaveFilePicker`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)).
Open the picker on click, *then* encode into the returned handle's writable stream.

**Careful trap:** Safari 26 *does* ship `FileSystemWritableFileStream`
([BCD](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemWritableFileStream.json):
Chrome 86, Firefox 111, Safari 26), and the WebKit 26.0 post advertises "direct writing to files
within the user's file system"
([WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
That is **OPFS only** — the origin-private file system, invisible to the user. Without
`showSaveFilePicker` there is no handle to a user-visible file. Same for Firefox 111. Do not read
`createWritable` support as save-to-disk support.

### 5.2 The universal fallback: anchor download

`<a download>` + `URL.createObjectURL(blob)`:
Chrome 14, Firefox 20, Safari 10.1, **Safari iOS 13**
([BCD `a.download`](https://github.com/mdn/browser-compat-data/blob/main/html/elements/a.json)).
Note Chrome 65+ refuses `download` on cross-origin `<a>` — irrelevant for `blob:` URLs of your own
origin.

This is the only mechanism that works everywhere Gerson targets. Cost: the whole file must exist as
a `Blob` first. In Chrome that is cheaper than it sounds — Chromium's blob system moves data to the
browser process and "if the in-memory space for blobs is getting full, or a new blob is too large to
be in-memory, then the blob system uses the disk"
([Chromium blob storage design](https://github.com/chromium/chromium/blob/main/storage/browser/blob/README.md)).
**Whether WebKit spills large blobs to disk: not found.** Assume on iOS that a 170 MB blob is 170 MB
of WebContent-process memory against the 1.5 GB budget (§2.2).

### 5.3 Mobile Safari third option: Web Share with files

`navigator.share({ files })` and `navigator.canShare({ files })`: **Safari 14 / iOS 14+**, Chrome
Android 76, Chrome desktop 89, **Firefox: no**
([BCD `Navigator.share`](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json)).
On iOS this opens the system share sheet, which includes "Save to Files" — often a better UX than a
download in an installed PWA, and it can hand the file straight to another app.
Requires transient activation and a same-origin secure context.

**Whether `<a download>` behaves correctly inside an iOS standalone-display-mode PWA (as opposed to
a Safari tab): not found** — no primary source located either way. This is the single highest-risk
unknown in the export path and should be a first-week manual test on a real device. Web Share is the
mitigation if it fails.

### 5.4 Recommended delivery ladder

1. `showSaveFilePicker` if present → `createWritable()` → stream chunks in → constant memory, user
   picks the name and location. (Chrome/Edge desktop, Chrome Android 132+.)
2. Else `<a download>` + object URL. (Everything else, incl. Safari desktop, Firefox, iOS 13+.)
   `URL.revokeObjectURL` after the click.
3. On iOS additionally offer an explicit "Share…" button gated on
   `navigator.canShare({ files: [f] })`.

---

## 6. Multi-stem export: zip or not?

### 6.1 Cost of a zip

Zip is only a packaging decision; it should add **no** compression. WAV/PCM does gain something from
DEFLATE, but a lossless audio codec beats it decisively at a fraction of the CPU — if size matters,
switch the payload to FLAC (§3.3) rather than deflating WAVs. So: **STORE-only zip**, which is a
header, the raw bytes, and a central directory. CPU cost ≈ a memcpy.

Memory then depends entirely on whether the writer streams:

- **Streaming (recommended):** a STORE-only writer emits a local file header, then the stem bytes,
  then accumulates one central-directory record per member. Peak extra memory ≈ one chunk. Combined
  with `showSaveFilePicker` + `createWritable()`, the whole 4-stem export runs in near-constant
  memory regardless of song length.
- **Non-streaming (`Blob` in memory):** peak ≈ the full archive. For a 4-minute song, four 16-bit
  WAV stems ≈ **169 MB**; a 10-minute track ≈ **424 MB**. On desktop Chrome the blob spills to disk
  (§5.2); on iOS assume it does not.

Format limit: the classic zip structure caps a member and the archive at 4 GB (2³²−1) — beyond that
Zip64 records are mandatory
([PKWARE APPNOTE.TXT §4.4.1.4, §4.4.8](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)).
Gerson will not approach 4 GB for one song's stems, so a plain non-Zip64 writer is sufficient — but
only if export is per-song and not "export whole library".

### 6.2 Recommendation

- **Chrome/Edge (picker available): one streamed STORE zip.** One picker prompt, one file, constant
  memory. Clean.
- **Everywhere else: do not zip by default — download the four stems as four sequential anchor
  clicks.** This avoids materialising a 170–424 MB blob on exactly the platforms that cannot afford
  it, and avoids the "why is this a zip I can't open on my phone" problem. Chrome-family browsers
  prompt once for "allow multiple downloads"; Safari desktop handles sequential downloads fine.
- **On iOS specifically, prefer "Export mix" (a single file) as the prominent action**, with stem
  export available but expectation-set — four sequential ~42 MB downloads on a phone, or four share
  sheets, is a poor flow, and iOS is the playback-first device per the map anyway. **Whether iOS
  Safari reliably handles four sequential programmatic downloads: not found** — test it.

---

## 7. Summary of answers to the ticket

1. **Input formats:** MP3, AAC-in-MP4/ADTS, FLAC, WAV/LPCM decode everywhere Gerson targets.
   Ogg Vorbis/Opus only on Safari **18.4+**/iOS 18.4+. ALAC is **Safari-only**. Chrome's AAC is
   absent from Chromium builds and Main-Profile-only; Firefox's AAC/MP3 depend on the OS.
   There is no static list — detect by attempting the decode.
2. **Chunked decode:** **not needed.** A 10-min stereo track decodes to 212 MB float32, which fits
   inside the 1.5 GB iPhone WebContent budget; the four stems (847 MB) are the real pressure and
   chunked decode does not help them. WebCodecs `AudioDecoder` also needs a hand-written demuxer and
   does not exist below iOS 26.
3. **Encoders:** WebCodecs can encode **Opus** in all three engines, AAC in Chrome/Safari only,
   Vorbis in Firefox only; **FLAC and MP3 encode in no browser** (WebKit rejects both explicitly).
   Export **WAV 16-bit** (dependency-free), add FLAC later via whatever WASM encoder 03 lands.
4. **Export semantics:** stems always 1× and always ignoring mute/solo/volume; a separate mix export
   that honours mute/solo/volume and loop, defaulting to 1× with an explicit tempo checkbox — and
   drop the checkbox entirely if ticket 02's stretcher cannot render in an `OfflineAudioContext`.
5. **Delivery:** `showSaveFilePicker` (Chromium only) → `<a download>` (universal, iOS 13+) →
   Web Share files as an iOS extra (Safari 14+). Safari 26's `FileSystemWritableFileStream` is
   OPFS-only and is **not** a save-to-disk path.
6. **Zip:** STORE-only, streamed into the file picker on Chromium; four separate downloads
   elsewhere; single mix file as the prominent mobile action.

### Open items / not found

- Per-browser WAV container support table (MDN does not publish one).
- Whether WebKit spills large `Blob`s to disk like Chromium does.
- Whether `<a download>` works reliably in an iOS standalone-display-mode PWA.
- Whether iOS Safari handles four sequential programmatic downloads.
- AIFF decode support in Chrome/Firefox.

All four device-behaviour unknowns need one manual iPhone test session; none of them changes the
recommended architecture, only which fallback fires.
