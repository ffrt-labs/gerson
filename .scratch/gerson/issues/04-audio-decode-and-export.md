# 04 — Which input formats decode, and what does export produce?

Type: research
Status: open
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
