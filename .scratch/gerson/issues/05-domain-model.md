# 05 — What is Gerson's domain model?

Type: grilling
Status: open
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
