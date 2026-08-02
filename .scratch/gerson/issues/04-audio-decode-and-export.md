# 04 — Which input formats decode, and what does export produce?

Type: research
Status: resolved
Blocked by: —

## Question

Two ends of the same pipe.

**Input.** The user uploads "a song". Resolve what `decodeAudioData` actually accepts across desktop
Chrome/Firefox/Safari and mobile Safari — mp3, m4a/AAC, flac, ogg, wav — and where it silently differs.
Establish the memory cost of decoding a long file, and whether a chunked decode path (WebCodecs
`AudioDecoder` + demuxing) is needed for, say, a 10-minute track, or whether one-shot decode is fine
for the file sizes Gerson will realistically see.

**Output.** Export is in scope. Resolve:

1. What formats we can encode in-browser and at what cost — WAV is trivial, Opus/FLAC need WebCodecs
   or a WASM encoder. Cross-reference 03, which faces the same encoder question for storage.
2. Whether export means individual stems, the current mix (respecting mute/solo/volume), or both —
   and whether the exported audio should reflect the current tempo setting or always be 1x.
   Recommend an answer; this is a small design call, not just a fact.
3. The delivery mechanism: `showSaveFilePicker` vs an anchor download, and what mobile Safari supports.
4. Whether a multi-stem export should be a zip, and what that costs in memory.

## Answer

**Input.** No static format list exists — `decodeAudioData` inherits the browser's `<audio>` codec
set. Safe everywhere: **MP3, AAC-in-MP4/ADTS, FLAC, WAV/LPCM**. Caveats: **ALAC is Safari-only**;
**Ogg Vorbis/Opus only on Safari 18.4+/iOS 18.4+**; Chrome's AAC is Main-Profile-only and absent
from Chromium builds; Firefox's AAC/MP3 rely on OS codecs. Detect by attempting a decode. Decode in
an `OfflineAudioContext` pinned to 44100 — `decodeAudioData` resamples to the context rate and
detaches the input `ArrayBuffer`.

**Chunked decode: not needed.** A 10-min stereo track is 212 MB as float32, inside the 1.5 GB iPhone
WebContent limit; the four stems (847 MB) are the real pressure and chunked decode does not help.
WebCodecs `AudioDecoder` also needs a hand-written demuxer and does not exist below iOS 26.

**Export.** Encode **WAV 16-bit** (dependency-free; FLAC and MP3 encode in *no* browser via
WebCodecs — WebKit rejects both explicitly). Two commands: **stems, always 1× and ignoring
mute/solo/volume** (the interop and re-import artifact), plus a separate **mix** export that honours
mute/solo/volume and loop, defaulting to 1× with an explicit off-by-default tempo checkbox — drop
that checkbox if 02's stretcher can't render in an `OfflineAudioContext`. Delivery:
`showSaveFilePicker` (Chromium only) → `<a download>` (universal, iOS 13+) → Web Share files on iOS.
Zip: STORE-only, streamed into the picker on Chromium; four separate downloads elsewhere.

Full findings, with sources: [`../research/04-audio-decode-and-export.md`](../research/04-audio-decode-and-export.md)

## Amendment (2026-08-02, from ticket 12)

**"Export stems" must write FLAC Vorbis comments into each stem file** — role, the song's `id`,
a schema version, and the title — rather than bare audio.

Ticket 12 needs a stem to answer for itself: 14 showed that inferring role from filenames guesses
invisibly, and 04's non-Chromium path is four separate downloads with no zip, so a `manifest.json`
would be an awkward fifth file that gets separated from its audio. Embedded tags survive loose
files, renaming, and picker reordering. Carrying the `id` is also what lets a song exported from one
machine import elsewhere as **the same Song** rather than a duplicate.

Everything else in 04 is unchanged: stems always 1× and always ignoring mute/solo/volume; the
separate mix export; STORE-only zip on Chromium; four sequential downloads elsewhere.

Two knock-ons:

- **libFLAC writes metadata blocks natively**, so the WASM encoder from 03 should already support
  this — confirm at build time rather than assume.
- **WAV cannot carry these tags** (no tag block a decoder respects), so WAV exports import through
  12's manual role-mapping path. This makes **FLAC the real export format and WAV the escape hatch**,
  rather than the two being interchangeable as 04 originally implied.

The export half and 12's import half must ship together, or the round-trip degrades to manual mapping.
