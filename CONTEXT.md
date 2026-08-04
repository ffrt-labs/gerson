# Gerson

A fully-offline browser tool for practising along to recorded music: upload a song, split it into
isolated instrument tracks, and play them back slowed down, isolated, and looped.

## Language

**Song**:
One uploaded recording together with the stems separated from it and the single practice state saved
against it. The top-level thing a user has; the library is a collection of Songs.
_Avoid_: Track, project, session, tune

**Practice state**:
The deliberate playback setup saved against a Song — tempo, loop region, and each Stem's level and
mute. Exactly one per Song; changing it overwrites rather than creating a variant. Momentary
gestures (solo, playhead position) are deliberately excluded and reset on reopening.
_Avoid_: Preset, mix, arrangement

**Tempo**:
Playback speed as a multiplier of the recording's own speed, from 0.5x to 2x, with pitch preserved.
Gerson does not know a song's beats per minute and never displays one.
_Avoid_: BPM, speed, rate, pitch

**Loop region**:
A start and end point within a Song between which playback repeats indefinitely. At most one per
Song. Not aligned to any beat grid, because Gerson has no notion of beats.
_Avoid_: Loop points, selection, region, marker

**Stem**:
One of the four isolated instrument recordings belonging to a Song. A Song always has exactly four,
one per Role; a set that is not exactly these four is not a Song and cannot be opened.
_Avoid_: Track, part, source, channel

**Recording**:
The original audio file a Song was made from, kept in full after separation. Used as the reference
mix and as the source for any future re-separation. Never one of the four Stems.
_Avoid_: Original, source file, master, upload

**Separation**:
The work of turning one uploaded recording into four Stems, and the thing that exists in the library
while that work is pending. Becomes a Song when it succeeds; leaves nothing behind when cancelled. A
failed Separation is the exception to "leaves nothing behind": it persists, with its cause and
timestamp, until the user dismisses it — the wreckage of a multi-minute job is the message, and
Retry reuses the retained Recording rather than asking for the file again. A Separation is never
playable.
_Avoid_: Job, task, split, processing, import

**Role**:
Which of the four instruments a Stem is: vocals, drums, bass, or other. A closed set — "other" is the
catch-all for everything not covered by the first three, including guitar and keys.
_Avoid_: Type, kind, instrument, category
