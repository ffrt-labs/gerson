# 05 — What is Gerson's domain model?

Type: grilling
Status: resolved
Blocked by: 01, 03

## Question

Pin down the ubiquitous language and the persisted schema, using `/domain-modeling`.

Open questions to walk:

- What is the top-level noun the user thinks in — a **Song**, a **Project**, a **Session**? Does one
  uploaded file ever produce more than one of them?
- What is a **Stem** — is it always one of the four fixed roles, or is the role a property of a more
  general track? (Bears on whether a future 6-stem model or an imported stem set fits without a
  schema break — 6-stem is out of scope, but a needless schema lock-in is still a cost.)
- What state is **persisted** vs **ephemeral**? Volume, mute/solo, tempo, loop region, playhead —
  which of these survive a reload, and which reset? Recommend, then confirm.
- What are the lifecycle **states** of a song: uploaded / decoding / separating / ready / failed —
  and which are persisted, so a tab closed mid-separation reopens into a sane state.
- Where does the **original file** live after separation — kept (needed for a re-split with a
  different model, and for a full-mix reference track) or discarded to save the space that 03 says
  is scarce?
- Identity: what makes two uploads "the same song"? Content hash, filename, or nothing at all?

Output: the domain glossary plus the persisted schema, written to the repo's domain model doc.

## Answer

Glossary: [`CONTEXT.md`](../../../CONTEXT.md). Schema and reasoning:
[research/05](../research/05-domain-model.md).

- **Song** is the top-level noun: one Recording + exactly four Stems + one Practice state. One
  upload produces at most one Song; there is no per-song variant/preset concept.
- **A Separation is a separate noun, not a Song with a status.** An upload becomes a Separation
  (`queued`/`running`/`failed`); it becomes a Song only when four stems exist. This keeps the Song
  invariant absolute — *if it is in the library as a Song, it plays* — and a failed or abandoned
  separation leaves nothing broken behind. A Song that cannot play is unrepresentable.
- **Stems are four fixed Roles** (vocals/drums/bass/other), not an open list. A set that is not
  exactly these four cannot be opened.
- **The Recording is kept.** ~1% storage overhead for a compressed upload, and it buys a true
  reference mix plus re-separation later without re-uploading. (The ticket asked whether to discard
  it to save space; 03 subsequently established space is not the binding constraint, so the premise
  had gone stale.)
- **Identity is a content hash of the Recording**, shared between the Separation and the Song it
  becomes. Re-dropping a known file opens the existing Song instead of paying nine minutes again.
- **Persisted practice state**: tempo, loop region, per-stem gain and mute. **Not persisted**: solo
  and playhead — momentary gestures, and reopening to three silent stems reads as a bug.

**Surfaced for ticket 12**: a Song always has a Recording, but an imported stem set has none. Import
must either synthesise one by summing stems, make `recording` nullable, or refuse such sets. A real
consequence of keeping the original, not an oversight.

