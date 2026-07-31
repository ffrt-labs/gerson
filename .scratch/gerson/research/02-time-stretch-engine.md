# 02 — Time-stretch engine for pitch-preserved 0.5x–2x

Research for [issue 02](../issues/02-time-stretch-engine.md). Date: 2026-07-31.

Sources are library source code, npm/GitHub API metadata, official docs and issue trackers.
Benchmarks marked **[measured]** were run by me on this machine (Apple Silicon, macOS 25.5,
Node v22.16.0 / V8 — same WASM engine as Chrome). Everything else is cited. Where a number is
not available from a primary source it says **not found** rather than guessing.

## TL;DR

**Recommend: `signalsmith-stretch` 1.3.2 (MIT), four independent AudioWorklet nodes, one per stem.**

**Sync verdict: four concurrent instances do NOT drift — but only because of a specific property of
this library's Web Audio wrapper, and only if you drive it a specific way.** The wrapper does not
accumulate position; it recomputes an absolute input position from the shared AudioContext clock on
every 128-sample render quantum. Given identical schedule inputs, all four nodes compute a
bit-identical integer sample position, forever. **[measured]** 0 samples of spread across 4 nodes
over 10 simulated minutes with 30 rate changes and an 8-second loop.

A single-stretcher architecture is **not** required, so per-stem mute/solo/volume stays trivial
(one `GainNode` per stretch node). See §3.5 for what the reconciliation would have looked like if
the answer had gone the other way.

**Runner-up: Rubber Band via `rubberband-wasm`.** Probably better raw quality, but it is
**GPL-2.0-or-later** — which for a static PWA means shipping Gerson itself under the GPL — and its
real-time API is explicitly pull-based with variable output per call and no automatic latency
compensation, so sample-lock across 4 instances would have to be built by hand.

---

## 3. SYNC — the load-bearing question (answered first, as asked)

### 3.1 What the four instances actually share

All `AudioWorkletProcessor`s belonging to one `AudioContext` run in one `AudioWorkletGlobalScope`
and see the same `currentTime`, which "is equal to the `currentTime` property of the
`BaseAudioContext`" and advances once per render quantum
([MDN, `AudioWorkletGlobalScope.currentTime`](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentTime)).
The default render quantum is 128 frames
([Web Audio API 1.1, `AudioContextRenderSizeCategory`](https://www.w3.org/TR/webaudio-1.1/#enumdef-audiocontextrendersizecategory)).

So there *is* a shared clock available. The question is whether the stretcher uses it, or whether it
accumulates.

### 3.2 Signalsmith's wrapper uses it — it re-seeks absolutely, every quantum

From [`web/web-wrapper.js`](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/web-wrapper.js)
(verified byte-identical in the shipped `SignalsmithStretch.mjs` 1.3.2), inside `process()`:

```js
let outputTime = currentTime + this.outputLatencySeconds;              // line 226
...
let inputTime = currentMapSegment.input
              + (outputTime - currentMapSegment.output)*currentMapSegment.rate;   // line 268
...
inputTime += this.inputLatencySeconds;
let inputSamplesEnd = Math.round(inputTime*sampleRate);                // line 276
...
// "constantly seeking, so we don't have to worry about the input buffers
//  needing to be a rate-dependent size"
wasmModule._seek(this.bufferLength, currentMapSegment.rate);           // line 314
wasmModule._process(0, outputBlockSize);                               // line 315
```

Three properties follow, and they are the whole answer:

1. **Position is an affine function of the shared clock**, not an integral of past rates. There is
   no per-instance accumulator that could diverge. `currentMapSegment` is `{input, output, rate}` —
   a fixed anchor point plus a slope.
2. **Rounding error is bounded and non-cumulative.** `Math.round` gives ±0.5 sample, recomputed from
   scratch each quantum. It never adds up.
3. **The stretcher is re-seeked every quantum** rather than being asked to emit "however many samples
   it feels like". The C++ `seek()` "doesn't do any calculation, just copies input to a buffer"
   ([`signalsmith-stretch.h` L138–162](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/signalsmith-stretch.h)),
   and `_process(0, outputBlockSize)` demands exactly 128 output samples for 0 declared input samples.
   **Output length per call is fixed by the caller, not by the algorithm.** This is the structural
   difference from every other candidate.

Two nodes handed the same `{input, output, rate}` therefore compute the *same integer*
`inputSamplesEnd`. Not "close" — the same.

### 3.3 The one way to break it, and the rule that prevents it

`schedule()` builds the anchor point like this (lines 67–85):

```js
let outputTime = ('outputTime' in objIn) ? objIn.outputTime : currentTime;   // line 68
...
Object.assign(obj, {input: null, output: outputTime});
Object.assign(obj, objIn);
if (obj.input === null) {
  let rate = (latestSegment.active ? latestSegment.rate : 0);
  obj.input = latestSegment.input + (obj.output - latestSegment.output)*rate;
}
```

If you omit an absolute time, `output` defaults to `currentTime` **at the render quantum in which
that node's `postMessage` happened to be delivered**. Four `MessagePort`s are four independent
deliveries — they will not land on the same quantum. Each node then anchors to a different time and
they separate permanently.

**[measured]** — I re-implemented the exact `timeMap` arithmetic above for 4 nodes, injected message
arrival jitter of 0/1/3/7 render quanta, ran 10 minutes of context time with a rate change every
20 s cycling 0.5/0.75/1/1.5/2, and measured worst-case spread in `inputSamplesEnd`:

| Driving style | no loop | with an 8 s loop region |
|---|---|---|
| explicit absolute `output` **and** `outputTime` | **0 samples** | **0 samples** |
| omitted (library default = arrival time) | 1 792 samples (37 ms) | 383 936 samples (8 s) |

The 8-second figure is the loop wrap: nodes cross `loopEnd` on different quanta, so one has already
subtracted the loop length while the others have not. That is the catastrophic failure mode, and it
is entirely caused by omitting the absolute time.

**Note a real inconsistency in the library.** The README documents the field as `output`, but line 68
tests for `outputTime`. Passing only `{output: T}` sets the stored anchor to `T` correctly (via the
second `Object.assign`) but leaves the *segment-pruning* loops on lines 71 and 98 comparing against
arrival time. Passing **both** `output: T` and `outputTime: T` makes every code path deterministic.
That is the rule: **every `schedule()` call must carry an absolute AudioContext time in both fields,
and all four nodes must be given the identical object.**

Corollary: never use `stretch.start()` with no arguments — line 53 defaults `output` to
`currentTime + outputLatencySeconds` at message-arrival time. Always pass an explicit `when`.

### 3.4 Why the other candidates cannot make this promise

**Rubber Band (real-time mode).** The API contract is explicitly variable-rate:
`getSamplesRequired()` varies with processing state, `available()` "may be 0", and the caller must
query it after every `process()` to learn how much came out
([RubberBandStretcher class docs](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandStretcher.html)).
The same page states that "in RealTime mode the stretcher performs no automatic padding or
delay/latency compensation at the start of the signal", with `getPreferredStartPad()` /
`getStartDelay()` left to the application and both engine-dependent. Nothing in the API guarantees
that two instances at the same ratio but different content emit the same number of frames on the same
call. Sample-lock is achievable — one worklet owning all four stretchers, feeding identical frame
counts and force-resyncing on divergence — but it is app-level work with no library guarantee behind it.

**SoundTouchJS (`@soundtouchjs/audio-worklet`).** Pull-from-FIFO, and the base class admits the
failure directly
([`SoundTouchProcessorBase.ts` L293–299](https://github.com/cutterbl/SoundTouchJS/blob/master/packages/worklet-base/src/SoundTouchProcessorBase.ts)):

```ts
const available = outputBuffer.frameCount;
const toExtract = Math.min(available, frameCount);
if (available < frameCount) { this._underrunCount++; }
```

On underrun it emits fewer than 128 frames, leaves the remainder of the block zeroed, and does **not**
advance source position to compensate. Every underrun is a permanent slip of that stem against
wall-clock. Four nodes underrun at different moments on different content, so relative drift is
guaranteed rather than merely possible — the library ships an `underrunCount` metric precisely
because it happens. This is disqualifying for Gerson.

**Hand-rolled phase vocoder.** Sync is whatever you build; you would end up reinventing §3.2. No
reason to, given MIT source that already does it.

**`playbackRate`.** Perfectly sample-locked and drift-free (it is a graph-level resample), but
`AudioBufferSourceNode` "resamples the audio before sending it to the output", so 0.5x is also an
octave down ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/playbackRate)).
Useful only as the correctness baseline to A/B sync against.

### 3.5 If the answer had forced a single stretcher

It does not, but for the record: the reconciliation is to run the four `GainNode`s **before** a single
stretcher and sum into it — mute/solo/volume then act on the pre-stretch mix and stay live and
sample-accurate, because `GainNode.gain` is an a-rate `AudioParam` on the shared graph clock. The
costs are (a) gain changes are heard `inputLatency + outputLatency` (120 ms at the default preset)
after they are made, (b) per-stem waveform/metering must be derived from the un-stretched sources
rather than tapped post-stretch, and (c) you lose per-stem pitch/formant options forever. None of that
has to be paid.

---

## 1. Quality at 0.5x

The strongest evidence is in the source, not in prose. `signalsmith-stretch.h` L509:

```cpp
static constexpr Sample maxCleanStretch{2}; // time-stretch ratio before we start randomising phases
```

and L638–640 in `processSpectrum()`:

```cpp
timeFactor = std::max<Sample>(timeFactor, 1/maxCleanStretch);
bool randomTimeFactor = (timeFactor > maxCleanStretch);
```

`timeFactor` in the worklet path is `seekTimeFactor`, set in `seek()` to `1/playbackRate` for any
realistic interval (L161). So:

- at **rate 0.5**, `timeFactor == 2.0`, and `2 > 2` is **false** → phases are **not** randomised. 0.5x
  sits exactly on the boundary of the algorithm's clean range.
- at **rate 2.0**, `timeFactor == 0.5`, exactly the `1/maxCleanStretch` clamp.

**The ticket's 0.5x–2x range is precisely the algorithm's documented-clean window `[1/2, 2]`.** Go
any slower and you enter deliberate phase randomisation. This is a strikingly good fit and is the
single best argument for this library over the alternatives.

Counterweight, from the same project's own README: "time-stretching sounds best for more modest
changes (between 0.75x and 1.5x)"
([README](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/README.md)). So 0.5x is
*inside* the clean window but at its far edge — expect audible artefacts, just not the randomised
kind.

On the specific artefacts the ticket asks about:

- **Transients / drums.** `grep -i transient signalsmith-stretch.h` returns nothing. There is no
  explicit transient detector; the algorithm relies on spectral peak tracking and phase-locking
  across bins (the `findPeaks` / `outputMap` / vertical-phase-twist machinery around L740–780). Rubber
  Band by contrast ships explicit transient options (`OptionTransientsCrisp`/`Mixed`/`Smooth`,
  [class docs](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandStretcher.html)).
  **Expect Rubber Band R3 to beat Signalsmith on isolated drum stems at 0.5x.**
- **Phasiness on sustained tone / vocals.** Signalsmith's whole design (ADC22 "Four Ways To Write A
  Pitch-Shifter") is phase-locked peak-relative prediction, which is the standard mitigation. Formant
  compensation is available (`setFormantSemitones`, `setFormantBase`) though not needed at
  transpose = 0.
- **Subjective A/B at 0.5x on real polyphonic stems: not measured here.** I cannot listen. This is
  the one open item and it wants a `wayfinder:prototype` ticket: load one real drum stem and one real
  vocal stem, play at 0.5x through both Signalsmith and `rubberband-wasm`, and decide by ear. Note
  that Gerson's material is *separated stems*, not full mixes — each stem is spectrally sparser than a
  mix, which generally favours phase-vocoder methods.

---

## 2. Latency and CPU for 4 concurrent instances

### 2.1 Latency is fixed, known, and identical across instances

`presetDefault` is `block = 0.12*sampleRate`, `interval = 0.03*sampleRate` (L63–65). At 48 kHz that
gives, read straight out of the WASM module **[measured]**:

| Config | inputLatency | outputLatency | total |
|---|---|---|---|
| `presetDefault` (120 ms / 30 ms), `splitComputation=false` | 2880 | 2880 | **120.0 ms** |
| same, `splitComputation=true` | 2880 | 4320 | **150.0 ms** |
| `configure(100 ms / 40 ms)`, split | 2400 | 4320 | 140.0 ms |
| `configure(60 ms / 15 ms)`, split | 1440 | 2160 | **75.0 ms** |

`splitComputation` costs exactly one extra interval of output latency, as the README states. Latency
is a pure function of the config — it does **not** vary with rate or with content, which is the other
half of why sync holds. Confirmed empirically by a third party in
[issue #13](https://github.com/Signalsmith-Audio/signalsmith-stretch/issues/13): a 48 kHz
`presetDefault` setup measured 120 ms through a speaker→mic loopback once the reporter's own
interleaving overhead was accounted for.

### 2.2 CPU **[measured]**

Harness: the actual shipped WASM (extracted from `SignalsmithStretch.mjs` 1.3.2), driven through the
exact worklet inner loop — per 128-frame quantum, copy `bufferLength` frames × 2 channels from a
4-minute stereo source into the WASM heap, `_seek(bufferLength, rate)`, `_process(0, 128)`, read the
output back. 30 s of audio per run after a 600-quantum warm-up. Budget per quantum is
128/48000 = **2.667 ms**.

| Config | rate | instances | % of one core | mean ms/quantum | worst quantum |
|---|---|---|---|---|---|
| `presetDefault`, split=false | 0.5 | 1 | 1.3 % | 0.034 | 0.57 ms |
| `presetDefault`, split=false | 0.5 | 2 | 2.6 % | 0.069 | 1.47 ms |
| **`presetDefault`, split=false** | **0.5** | **4** | **5.1 %** | **0.137** | **1.27 ms** |
| `presetDefault`, split=false | 1.0 | 4 | 5.1 % | 0.136 | **5.28 ms** ⚠ |
| `presetDefault`, split=false | 0.5 | 8 | 10.5 % | 0.280 | **10.45 ms** ⚠ |
| **`presetDefault`, split=true** | **0.5** | **4** | **5.4 %** | **0.145** | **0.62 ms** ✅ |
| 100 ms/40 ms, split=true | 0.5 | 4 | 4.1 % | 0.109 | 0.64 ms |
| 60 ms/15 ms, split=true | 0.5 | 4 | 4.5 % | 0.119 | 0.71 ms |

Readings:

- **Mean CPU is a non-issue.** 4 stereo stems at 0.5x cost ~5 % of one core on Apple Silicon. Cost is
  linear in instance count and flat in rate.
- **The peak is the risk, and `splitComputation: true` fixes it.** With it off, the spectral block
  lands in one quantum and produced worst-case quanta of 1.3–10.5 ms against a 2.667 ms budget — i.e.
  it *can* exceed the budget and glitch. With it on, worst-case collapses to ~0.62 ms, ~4× under
  budget. This matches the README ("the library will occasionally do a bunch of computation all at
  once… if you're in a stricter situation then this flag might help"). Four worklet nodes all render
  on the **same** audio thread, so their spikes add. **Ship with `splitComputation: true`** and accept
  150 ms latency, or drop to 60/15 for 75 ms at similar cost.
- **The constant-reseek design costs about one extra analysis FFT per spectral block**: `seek()` sets
  `didSeek = true`, and L303 does `reanalysePrev = didSeek || …`, adding `analyseSteps() + 1` on every
  new spectrum. Already included in the numbers above.
- **Phone: not measured.** No device here. Scaling the desktop figure by a typical 3–4× per-core gap
  puts 4 stems at roughly 15–20 % of one core on a mid-range phone, but that is an extrapolation, not
  a measurement. Given the ~4× peak headroom with `splitComputation`, the phone should hold; verify on
  hardware before committing.
- The WASM is built **without** SIMD and **without** pthreads —
  [`web/emscripten/compile.sh`](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/emscripten/compile.sh)
  is `-O3 -ffast-math -fno-exceptions -fno-rtti -sSINGLE_FILE=1 -sMODULARIZE -sSTRICT=1
  -sDYNAMIC_EXECUTION=0`, no `-msimd128`, no `-pthread`. So **no SharedArrayBuffer, no COOP/COEP
  headers required** — relevant to the map's open "Distribution" question. There is headroom left on
  the table (a SIMD rebuild is possible but would mean maintaining a fork).

### 2.3 The real cost is memory, not CPU

The worklet's stretch nodes only time-stretch in **buffer mode**. In live-input mode the wrapper calls
`_process(outputBlockSize, outputBlockSize)` — equal in and out, i.e. rate is forced to 1 — and the
README confirms "if the node is processing live input (not a buffer) then
`input`/`rate`/`loopStart`/`loopEnd` are ignored". **You cannot feed four `AudioBufferSourceNode`s into
four stretch nodes and expect slow-down.** Each node must own its stem's PCM via `addBuffers()`.

That means four full copies of decoded audio live inside the `AudioWorkletGlobalScope` JS heap:

| Song length | per stereo stem @44.1 kHz f32 | ×4 stems |
|---|---|---|
| 3 min | 63.5 MB | **254 MB** |
| 4 min | 84.7 MB | **339 MB** |
| 6 min | 127 MB | **508 MB** |

(44 100 × 2 ch × 4 B = 352.8 kB/s.) That is a genuine mobile-Safari-tab-kill risk. Mitigations, in
order of preference:

1. `addBuffers()` / `dropBuffers(toSeconds)` streaming — the README explicitly offers this "when
   processing streams or very long audio files". Keep a resident window around the playhead plus the
   whole loop region. Seeks outside the window need a re-fill.
2. Transfer rather than clone: the wrapper's `post()` pops a trailing argument as the transfer list
   (`audioNode.addBuffers(buffers, buffers.map(b => b.buffer))`), so the main-thread copy is released
   rather than duplicated.
3. Mono stems for practice on phones (halves everything). Quality cost, but this is a practice tool.

Also note: each node constructs its **own** emscripten instance (`Module()` inside the processor
constructor), so there are 4 independent WASM heaps — but those are small, only
`bufferLength × channels × 2` floats ≈ 92 kB each. The audio arrays are plain JS `Float32Array`s in the
shared worklet scope, which is where the 339 MB lives.

---

## 4. Seek and loop behaviour

**Looping is built in and needs no application-level scheduling.** `schedule()` accepts
`loopStart` / `loopEnd` in seconds, and the wrap is handled inside the render quantum (L269–273):

```js
let loopLength = currentMapSegment.loopEnd - currentMapSegment.loopStart;
if (loopLength > 0 && inputTime >= currentMapSegment.loopEnd) {
  currentMapSegment.input -= loopLength;
  inputTime -= loopLength;
}
```

Because this is a pure function of the shared clock and the shared segment, **all four nodes wrap on
the same quantum** (see the §3.3 table: 0 samples of spread with an 8 s loop over 10 minutes).

**Why the wrap does not click.** After wrapping, the code fills the WASM input buffer with the
`bufferLength` samples *preceding* the new position — i.e. real audio from just before `loopStart`,
used as pre-roll — then calls `_seek()`, which per the header comment "provide[s] previous input
('pre-roll') to smoothly change the input location **without interrupting the output**". Crucially
`_seek()` does **not** call `reset()`, so output phase is continuous across the jump. Signalsmith
confirmed this design in
[issue #5](https://github.com/Signalsmith-Audio/signalsmith-stretch/issues/5): "you can use that same
method to jump to a new location… If you want the output to stay continuous (no clicks/etc.) just
don't call `.reset()`". The wrapper sizes its buffer for exactly this: `bufferLength = inputLatency +
outputLatency`, commented "longer than one STFT block, so we can seek smoothly" (L202).

**Arbitrary seek** is the same mechanism: `schedule({input: newSeconds, output: T, outputTime: T,
rate})`. No flush, no reset, no discontinuity. Scrubbing is supported too — the C++ `seek()` takes a
`playbackRateHint` and Signalsmith recommends passing `0` "if you want to scrub around the input"
(issue #5).

**Caveats found in the tracker.**
[Issue #22](https://github.com/Signalsmith-Audio/signalsmith-stretch/issues/22) (open, filed
2025-07-16) is a `RangeError: offset is out of bounds` at exactly the L300 line
`buffer.subarray(blockSamples).set(channelBuffer.subarray(startIndex, startIndex + count))`, reported
when feeding 100 ms chunks with a **changing rate between chunks**. It is a streaming/`addBuffers`
bug, not a looping bug, and Gerson can avoid it by loading whole stems (or large windows) rather than
100 ms chunks — but it is the code path mitigation (1) in §2.3 would use, so exercise it early if you
go the streaming route. Fixed-buffer playback does not touch it.

---

## 5. Licence, bundle size, maintenance

| Candidate | Licence | Ships as | Size | Last release | Maintenance |
|---|---|---|---|---|---|
| **`signalsmith-stretch` 1.3.2** | **MIT** | one self-contained `.mjs`, WASM inline as base64 (`-sSINGLE_FILE=1`) | **113 781 B raw / 47 592 B gzip** | npm 2025-06-27; repo HEAD 2026-01-24 | Active. 530★, author responsive (issue #21 filed and fixed inside 16 days). 5 open issues. |
| `rubberband-wasm` 3.3.0 | **GPL-2.0** | separate `rubberband.wasm` + JS | 265 101 B wasm (116 144 B gzip) + 6 756 B min JS | 2024-12-23 | Low activity, 49★, 0 open issues. Wraps Rubber Band 3.x; upstream is at **4.0.0** (2024-10-25). |
| `rubberband-web` 0.2.1 | GPL-2.0-or-later | AudioWorklet + Worker | 1 450 140 B unpacked | **2022-10-18** | Effectively dormant (~4 years), 17★. |
| `@echogarden/rubberband-wasm` 0.2.0 | GPL-2.0-only | WASM | 474 224 B unpacked | 2024-10-26 | "Intended for use with Echogarden" — not a general-purpose Web Audio package. |
| `@soundtouchjs/audio-worklet` 2.1.0 | MPL-2.0 | pure-JS worklet | 296 114 B unpacked | **2026-07-08** | Very active (monorepo rewrite, 303★) — but see §3.4. |
| hand-rolled phase vocoder | — | — | — | — | Reinvents §3.2 for no gain. |

Licence is decisive against Rubber Band. Rubber Band Library is "open source software under the GNU
General Public License" and "if you want to distribute it in a proprietary commercial application, you
need to buy a license" ([breakfastquay.com/rubberband](https://breakfastquay.com/rubberband/)). A PWA
ships its JS/WASM to every visitor, which is distribution; using it means Gerson itself is GPL. That
may be acceptable for a hobby tool but it is a deliberate decision, not a detail — and there is no
commercial escape hatch that does not involve paying Breakfast Quay.

Practical packaging notes for `signalsmith-stretch`:

- **Single file, no separate WASM fetch** — ideal for `vite-plugin-pwa` precaching. Nothing extra to
  add to the service-worker manifest.
- Built with `-sDYNAMIC_EXECUTION=0` (no `eval`), but the wrapper does
  `URL.createObjectURL(new Blob([moduleCode]))` + `audioWorklet.addModule()` (L370–375). A strict CSP
  will need `worker-src blob:`.
- **No TypeScript types.** [Issue #26](https://github.com/Signalsmith-Audio/signalsmith-stretch/issues/26)
  (open, 2025-11-09): the author is not a TS developer and asked for help. Gerson is TS, so budget a
  hand-written `.d.ts` — the surface is small (~10 methods, one options object).
- Construction is async (`await SignalsmithStretch(ctx)`) because `addModule()` is async; same issue.
  Four `await`s at load time, or one `Promise.all`.
- Works with a native `AudioContext`; Tone.js/`standardized-audio-context` needs unwrapping to the
  native context ([issue #27](https://github.com/Signalsmith-Audio/signalsmith-stretch/issues/27)).
  Gerson has no reason to use Tone.js — use the native API.
- Version discipline: **1.3.2 or newer**. 1.3.0 had a bug producing silence
  ([issue #21](https://github.com/Signalsmith-Audio/signalsmith-stretch/issues/21)).

---

## What this constrains downstream

1. **Playback engine (ticket 06)** is now shaped: 4 × `SignalsmithStretch` node → 4 × `GainNode` →
   master. Transport state is a single `{input, output, rate}` anchor in AudioContext time, broadcast
   identically to all four nodes. There is no per-stem playhead.
2. **Every transport action is a `schedule()` with an explicit absolute time.** Write one
   `scheduleAll(anchor)` helper that fans the *same frozen object* out to all four nodes with both
   `output` and `outputTime` set, and never call `.start()`/`.stop()`/`.schedule()` on a single node.
   This one rule is the whole sync story; make it structurally impossible to violate.
3. **Ship `splitComputation: true`.** Non-negotiable given the measured peak-quantum data.
4. **Storage format (ticket 03) should think about mono and about windowed loading.** 339 MB of
   resident Float32 for a 4-minute song is the binding constraint on phones, not CPU.
5. **UI position** comes from `stretch.inputTime` + `setUpdateInterval()`, or better, computed on the
   main thread from the same anchor against `audioContext.currentTime` — which gives a
   free 60 fps playhead for the waveform work in the map's "not yet specified" list.
6. **Open, worth a prototype ticket:** subjective 0.5x quality on real drum and vocal stems,
   Signalsmith vs Rubber Band. That is the only question in this ticket I could not answer from
   primary sources.

## Switch condition

Move to Rubber Band only if the 0.5x listening test shows Signalsmith's drum-stem smearing to be
unacceptable **and** the project accepts GPL licensing. In that case, do not run four Rubber Band
instances as peers — run one AudioWorklet owning all four `RubberBandStretcher`s, feed them identical
frame counts, and re-derive position from `currentTime` rather than from `available()`, replicating
§3.2 by hand.
