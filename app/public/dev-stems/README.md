# Dev playback fixtures

Not checked in — `*.wav` is gitignored, and these are ~40 MB each.

The `/dev/playback` dev route (issue #23) expects four files here:
`vocals.wav`, `drums.wav`, `bass.wav`, `other.wav` — the same fixture stems
used by the `prototype/playback-harness` research prototype. Copy them from
there, or from any four same-length stems of your own:

```sh
cp ../../prototype/playback-harness/public/stems/*.wav .
```
