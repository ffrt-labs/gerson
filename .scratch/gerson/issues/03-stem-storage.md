# 03 — How are stems stored on-device, and in what format?

Type: research
Status: open
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
