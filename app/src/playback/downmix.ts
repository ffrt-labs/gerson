/**
 * The mono override's downmix step (§4.5): a playback-time average of the
 * decoded stereo channels, applied after decode and before `addBuffers`.
 * Stored stems stay stereo FLAC on disk — this never touches storage, so
 * it's reversible without re-encoding.
 */
export function downmixToMono(left: Float32Array, right: Float32Array): Float32Array {
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    out[i] = (left[i] + right[i]) / 2;
  }
  return out;
}
