# 05 — Domain model and persisted schema

Glossary lives in [`CONTEXT.md`](../../../CONTEXT.md). This file holds the persisted schema and the
reasoning that does not belong in a glossary.

## Shape

Two top-level records, not one. **A Separation is not a Song.** An upload becomes a Separation;
it becomes a Song only once four Stems exist. This keeps the Song invariant absolute — *if it is in
your library as a Song, it plays* — and means a failed or abandoned separation leaves no broken
entry behind.

```
Separation  ──succeeds──>  Song ──has──> exactly 4 Stems (one per Role)
                            │
                            ├──has──> 1 Recording   (the original upload, kept)
                            └──has──> 1 Practice state
```

## IndexedDB — the catalogue

Per ticket 03: IndexedDB holds metadata, OPFS holds the audio bytes. Records point at OPFS paths;
no audio is ever stored in IndexedDB.

### `songs`

| field | type | notes |
|---|---|---|
| `id` | string | content hash of the Recording — see Identity below |
| `title` | string | from the uploaded filename, user-editable |
| `durationSec` | number | |
| `sampleRate` | number | always 44100 (ticket 04 pins decode to it) |
| `createdAt` | number | epoch ms |
| `recording` | `{ path, bytes, mimeType }` | OPFS path to the original upload |
| `stems` | `Record<Role, StemRef>` | keyed by role, exactly four keys |
| `practice` | `PracticeState` | see below |

`Role = 'vocals' | 'drums' | 'bass' | 'other'` — closed set.

`StemRef = { path, bytes, peaksPath }` — OPFS paths for the FLAC stem and its precomputed peaks
(Int8 min/max pairs at 256 samples/pixel, ~82.7 KB per stem, settled in ticket 03).

`PracticeState`:

| field | type | notes |
|---|---|---|
| `tempo` | number | 0.5–2.0, default 1 |
| `loop` | `{ startSec, endSec } \| null` | at most one region |
| `stems` | `Record<Role, { gain: number, muted: boolean }>` | gain 0–1.5, default 1 |

**Not persisted, by decision:** solo state and playhead position. Solo is a momentary "let me hear
just this" gesture, and reopening to three silent stems reads as a bug. Playhead resets to 0, or to
`loop.startSec` when a loop is set — predictable beats continuous.

### `separations`

| field | type | notes |
|---|---|---|
| `id` | string | content hash of the uploaded file — the same value the Song will take |
| `title` | string | from the filename |
| `status` | `'queued' \| 'running' \| 'failed'` | no `'complete'`: on success the record is deleted and a Song is written |
| `uploadPath` | string | OPFS path to the uploaded bytes, so a reload does not need re-upload |
| `progress` | number | 0–1, from demucs.cpp's `PROGRESS_UPDATE` (ticket 01) |
| `error` | string \| null | populated when `status === 'failed'` |
| `startedAt` | number | epoch ms |

Sharing the id with the eventual Song means the transition is a delete-and-insert under one key,
and a duplicate upload can be detected against in-flight work as well as the finished library.

## Identity

`id` is a **content hash of the Recording bytes**. Re-dropping a file already in the library opens
the existing Song rather than separating again — nine minutes and ~470 MB saved per avoided repeat.

Consequences accepted:
- The same track as MP3 and as WAV are two different Songs. Correct, arguably: different bytes in
  means different stems out.
- A hash must be computed before separation starts, so it also guards against queueing the same
  file twice.

## Song lifecycle

```
upload ──> Separation(queued) ──> Separation(running) ──> Song
                                        │
                                        └──> Separation(failed) ──> user deletes, or retries
```

There is no "ready" or "complete" state on a Separation, and no "separating" state on a Song. Each
record only ever exists in states that are true of it. A Song that cannot play is unrepresentable.

**Reopening mid-separation**: a `running` Separation whose worker is gone reverts to `queued` on
load. Whether it then auto-resumes or waits for the user is ticket 07's call, not a modelling
question — the schema supports either.

## What this does NOT decide

- Whether a `failed` Separation is auto-deleted or kept for the user to see → **ticket 11**.
- Whether imported stem sets get a provenance marker → **ticket 12**. Note the current model has no
  place for one: a Song is a Song regardless of origin. If 12 decides provenance matters, it adds a
  field; if it decides Gerson should refuse non-Gerson stem sets, nothing changes.
- Storage quota handling and eviction → **ticket 11**, informed by 03.

## Open tension worth flagging to ticket 12

The model says a Song *always* has a Recording. But an imported stem set has no original recording —
only four stems. Either import synthesises a Recording by summing the stems, or `recording` becomes
nullable, or imported stem sets are refused. **Ticket 12 must resolve this**; it is a genuine
consequence of keeping the original, not an oversight.
