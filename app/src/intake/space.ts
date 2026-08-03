// ~93 MB: 4 FLAC stems at 44.1 kHz / 16-bit for a typical song
export const STEMS_SIZE_BYTES = 93 * 1024 * 1024;

export interface SpaceCheckResult {
  ok: boolean;
  needsBytes: number;
}

type EstimateFn = () => Promise<StorageEstimate>;

export async function checkSpace(
  recordingBytes: number,
  estimate: EstimateFn = () => navigator.storage.estimate(),
): Promise<SpaceCheckResult> {
  const needed = STEMS_SIZE_BYTES + recordingBytes;
  const { quota = 0, usage = 0 } = await estimate();
  const available = quota - usage;
  return { ok: available >= needed, needsBytes: needed };
}
