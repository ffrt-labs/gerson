# 03 — How are stems stored on-device, and in what format?

Type: research
Status: resolved
Blocked by: —

## Question

A persistent local library is settled. 4 stems of a 4-minute song at 44.1kHz stereo is roughly
160MB as raw WAV — a library of 20 songs is 3GB+. That is not obviously survivable.

Resolve:

1. **OPFS vs IndexedDB** for large binary blobs: real-world write throughput, read/seek behaviour
   (can we stream a stem into an AudioBuffer without holding the whole file twice in memory?),
   and browser support including mobile Safari.
2. **Quota**: what a desktop Chrome and a mobile Safari PWA actually get, how to query it
   (`navigator.storage.estimate`), and whether `persist()` meaningfully prevents eviction.
3. **Format**: WAV vs FLAC vs Opus for stored stems. Quantify the size/quality/decode-cost trade.
   Lossy compression on a stem that will be soloed and slowed to 0.5x is a real quality question,
   not a neutral one — say whether Opus at a sane bitrate is acceptable for practice use.
4. **Encoding path**: what can actually encode in-browser — WebCodecs `AudioEncoder` support matrix,
   or a WASM encoder. Note that this overlaps with the export decision in 04.
5. **Eviction and cleanup**: what the app must do when quota is hit or storage is cleared out from
   under it.

Output a recommended storage layout (what files/records exist per song) with sizes for a worked example.

## Answer

**Storage API: OPFS for audio, IndexedDB for the catalogue.** OPFS sync access handles (Workers only,
Chrome 102 / Chrome Android 109 / Safari 15.2 / Firefox 111) give positional `read(view, {at})` into a
caller-allocated buffer, so a stem loads without holding the file twice. IndexedDB holds one small
record per song; never blobs. Unavailable in Safari Private Browsing — degrade to ephemeral.

**Format: lossless — FLAC, 16-bit 44.1 kHz stereo, level 5, encoded *and decoded* in WASM** (no
browser exposes a FLAC encoder via WebCodecs; Chromium's `AudioEncoder` does Opus and AAC only, and
Safari's `decodeAudioData` codec support is unreliable). 16-bit WAV is the zero-dependency fallback.

**Lossy call, made explicitly: no.** Opus is rejected for stored stems. It has no 44.1 kHz mode
(RFC 6716 — internal rate is always 48 kHz), soloing removes the masking its bit allocation assumes,
0.5x stretching smears codec pre-echo at exactly our operating point, and it would be indistinguishable
from Demucs' own artifacts. Above all, compression buys nothing we need. Keep Opus 96 kbps for
export/transfer (ticket 04) and as an opt-in "compact library" escape hatch only.

**Quota verdict: not the binding constraint.** Chrome and Safari 17+ both grant ~60% of total disk;
a 20-song FLAC library is 1.87 GB (WAV would be 3.40 GB) — under 3% of quota on a 128 GB iPhone. The
real risks are (a) Chrome's ~300 MB cap when "clear site data on close" is on, and (b) iOS ITP
deleting storage after 7 idle days — from which **installed Home Screen web apps are exempt**, so
iOS onboarding must push installation before the first split. Call `persist()`, pre-flight with
`estimate()`, reconcile OPFS against IndexedDB on startup.

Findings: [`.scratch/gerson/research/03-stem-storage.md`](../research/03-stem-storage.md)

## Revisited by ticket 06 (not reversed)

The stereo lossless-FLAC storage decision **stands** — 06 showed the memory problem is fixable
without touching the storage format. But the *loading path* changes: rather than decoding to an
`AudioBuffer`, decode FLAC in the WASM codec straight into a plain transferable `Float32Array` and
hand it to the worklet with a transfer list. That avoids the duplicate copy 06 measured and sidesteps
`decodeAudioData`'s cross-browser codec roulette entirely. See
[research/06](../research/06-playback-engine-prototype.md).
