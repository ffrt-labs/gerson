# 12 — How does importing an already-split stem set work?

Type: grilling
Status: resolved
Blocked by: —

## Question

Graduated from fog now that 04 has fixed the export format.

**Re-justified while working ticket 11**, when mobile went out of scope. The original rationale —
"this is the reliable phone path", since 01 showed mobile cannot run separation — no longer applies.
Import survives on two grounds that have nothing to do with phones:

- **It is the only way a library moves at all.** Cross-device sync is permanently out of scope (it
  needs a server), so export-here / import-there is the entire story for getting a song onto another
  machine. Without import, a separation is trapped on the machine that ran it.
- **It is the insurance policy against paying nine minutes twice.** 05's content-hash identity only
  protects you inside one browser profile; eviction, a cleared profile, or a different browser all
  mean re-separating. Import is what makes "Export stems" more than a dead-end button — and 04 has
  already fixed the export format, so the two halves must agree regardless.

What it loses is only *urgency*: no longer the sole route onto a device, so a plain file-picker flow
is enough — it does not need designed onboarding.

Resolve:

- **What is imported** — four loose files the user selects, or a single container produced by
  "Export stems"? 04 recommends STORE-only zip on Chromium and separate downloads elsewhere, so the
  import side must accept both shapes.
- **Role assignment**: how does the app know which file is the bass? Filename convention from our own
  exporter, embedded metadata, or an explicit mapping UI on import. Recommend — and say what happens
  for a stem set that did *not* come from Gerson.
- **Validation**: identical sample rate, identical length, and what to do when they differ (reject,
  or pad/resample). Mismatched lengths break the shared clock 02 depends on.
- **Provenance in the domain model**: is an imported song distinguishable from a separated one, and
  does it matter? (Bears on 05 — it may need a `source` field.)
- **Partial sets**: is importing 2 of 4 stems legal, or is a complete set required?

## Sharpened by ticket 14

The prototype's stem-identification approach failed in practice and is a worked example of what not
to ship: it guessed roles by filename substring, and **silently accepted the original song as a
single "stem"** and played it. The user could not tell from the UI that anything was wrong.

So role assignment needs to be either explicit (a mapping UI) or verified (metadata written by our
own exporter), and import must **reject** rather than guess — with a visible reason. Add to the
validation list: a single file dropped where four are expected.

## Answer

Resolved by grilling. The through-line: **import must never guess invisibly** (14's worked example)
and **must never make the user pay for the same nine minutes twice** (05's identity rule). Almost
every decision below falls out of one of those two.

### 1. The missing Recording — synthesise it by summing the stems

05 flagged a genuine tension: a Song always has a Recording, but an imported set is four stems and
nothing else. Of 05's three options — sum, nullable, refuse — **import sums the four stems into a
Recording.**

**The deciding reason is identity, not tidiness.** `id` is a content hash *of the Recording bytes*,
so with no Recording there is nothing to hash and 05's dedup mechanism has no input at all —
re-importing the same set would silently create a second ~93 MB copy of the same Song. A sum of
deterministic FLAC decodes is a deterministic byte sequence, so **the same four files always hash to
the same id**, and re-import opens the existing Song.

It is also true rather than a fudge: Demucs stems sum back to the input by construction — the same
fact 10 used to rule out a fifth waveform lane — so the synthesised Recording genuinely is the
reference mix. And `recording` stays non-nullable, so nothing downstream branches on origin.

Cost, stated honestly: one summing pass at import, plus one more FLAC (~25% on top of the stems).
Nullable would save that but puts a null check in every path touching a Recording and leaves
identity unsolved.

### 2. Stem files carry embedded tags — this amends 04

04 exports **bare audio with no metadata**, which is not enough for import to verify anything. The
fix is on the export side, so **12 amends 04** (see §7).

**Metadata is embedded in each stem as FLAC Vorbis comments**: role, the song's original id, a schema
version, and the title. Rejected alternative: a `manifest.json` in the zip — 04's non-Chromium path
is *four separate downloads with no zip*, so a manifest becomes an awkward fifth file, and any file
that can be separated from its audio eventually is. Embedded tags survive loose files, renaming, and
reordering in the picker.

libFLAC writes metadata blocks natively, so the WASM encoder 03 pulls in should already support
this — **confirm at build time rather than assume.**

Three consequences:

- **The original id travels.** If the tag is present, import adopts *that* id rather than the
  synthesised hash, so a song exported from one machine and imported on another **stays the same
  Song**. The synthesised hash is the fallback for untagged sets.
- **Filenames are a human convenience only**, never trusted for role — exactly 14's failure.
- **WAV exports are untagged by nature** (no tag block a decoder respects). 04's ladder starts at WAV
  before FLAC lands, so WAV sets import through the manual path in §3. This is an argument for
  **FLAC being the real export format and WAV the escape hatch.**

### 3. Untagged sets — an explicit mapping step

Untagged is not exotic: it includes **our own WAV exports**, plus Demucs CLI, Spleeter, and
downloaded stem packs. Refusing untagged would break our own escape hatch.

**Four files, four role dropdowns, nothing proceeds until all four are assigned.** The import unit is
the user's selection — whatever was picked in one go is one candidate set.

**Filenames may prefill the dropdowns under one strict condition**: the four filenames must yield
**four distinct roles unambiguously**, or nothing is prefilled and all four start empty. A partial or
ambiguous match prefills nothing — half-guessing is worse than not guessing, because it produces a
form that looks already-correct.

**Prefill is a suggestion the user commits to, never an auto-accept.** 14's failure was not that the
guess was wrong but that it was *invisible*; a visible, editable mapping is a different thing even
when the values are identical.

**One file where four are expected** is rejected before the mapping step, with a redirect rather than
an error: this looks like a single mixed track, not a stem set — separate it instead.

**Not built: content-based role detection** (inferring bass from spectral centroid). It is a research
project, it will be wrong on real material, and it recreates the invisible-guess failure with more
machinery.

### 4. Validation

**Sample rate is not a rejection reason.** 04 pins decode to an `OfflineAudioContext` at 44100, so a
48k stem resamples on the way in. Rejecting on rate would refuse good third-party stems for nothing.

**Length is a tolerance, not an equality check** — 02's shared clock and 06's sample-locked playback
assume the four buffers describe the same span:

| spread | action |
|---|---|
| **≤ 1 second** | pad the short ones with silence to the longest |
| **> 1 second** | reject, showing all four durations — the numbers are the explanation |

Our own exports are sample-identical; third-party sets pick up encoder padding and codec delay, and
refusing a set because one stem is 23ms short would be pedantic and inexplicable.

**Every file must decode first**, per file, using the same rule and the same browser-naming message
11 settled — naming *which* file failed.

**Partial sets (2 of 4) are refused.** 05 fixed a Song as exactly four Stems with fixed Roles, and
silence-filling the missing two manufactures a Song that misrepresents itself: a silent bass track
would be indistinguishable from a muted one, and "absent" would have no representation. A
vocals+instrumental pair is a different product shape.

**Identity is checked before any work.** If the tagged id — or the synthesised hash — is already in
the library, open that Song instead of importing. Same principle as re-dropping a known file: never
pay twice.

### 5. Input shapes — one drop zone, zip or loose files

04 gave export two shapes, so import accepts both or half our own exports cannot return.

**The drop decides**: a single `.zip` is unpacked; multiple audio files are the set. No mode switch —
the user should not have to tell the app which kind of export they are holding.

- **Deflate is supported, not just STORE.** Our zips are STORE, but third-party stem packs are likely
  deflated. `DecompressionStream('deflate-raw')` is native in all three engines, so this is a few
  lines, and the alternative is an error about a file that looks entirely normal to the user.
- **A zip is a container, not a promise.** Unpacked contents take exactly the same path as loose
  files — decode, read tags, map roles, validate lengths. No shortcut for having arrived in a zip.

**Folder drop (`webkitdirectory`) is not built** — a third input shape for a case the other two
cover, and 12 lost its urgency when mobile went out of scope.

### 6. Provenance — on the Recording, not the Song

05 asked whether imported sets get a provenance marker, noting the model has no place for one.

**Add `recording.origin: "uploaded" | "summed"`** — on the **Recording**, not the Song. The
distinction created in §1 is specifically about the Recording: a synthesised one is a sum of
already-separated stems, not an original master. Two things care:

- **Re-separation.** 05 kept the Recording partly to allow re-separating with a better model later.
  Running Demucs over a sum of Demucs output is a meaningfully worse input, and a future feature
  should be able to see that.
- **Honesty about what the file is.** If reference-mix A/B ever ships (parked in fog by 10),
  comparing against a summed mix is not comparing against the master, and labelling it "Original"
  would be a small lie.

This preserves 05's principle exactly: **a Song is still a Song regardless of origin**, nothing
branches on how it arrived, and there is **no library-level "imported" badge** — no user value in
one. The field is consulted only where the difference bites.

### 7. Amendment forced on 04

04's export decisions stand except one: **"Export stems" must write FLAC Vorbis comments** (role,
song id, schema version, title) into each stem, rather than bare audio. Everything else — always 1×,
always ignoring mute/solo/volume, STORE-only zip on Chromium, four sequential downloads elsewhere —
is unchanged. Recorded on 04 as an amendment; it is the export half of §2 and the two must ship
together or the round-trip degrades to the manual mapping path.
