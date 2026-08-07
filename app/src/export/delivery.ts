/**
 * The delivery ladder (§6.1): showSaveFilePicker (Chromium only) streams a
 * STORE-only zip straight into the save dialog → <a download> falls back to
 * four sequential downloads, the universal floor → navigator.share({files})
 * covers whatever's left, chiefly mobile contexts where a plain download
 * doesn't really land anywhere the user can find it. The same three rungs
 * serve Export mix's single file too (deliverFile) — no zip there, since
 * one file needs no container.
 *
 * Each rung is a thin, individually-injectable wrapper around a browser
 * API, so the ladder's *choice* of rung is unit-testable without a DOM.
 */

import { writeStoreZip, type ZipSink } from './zip.ts';

/** The subset of an exported file the delivery ladder actually needs. */
export interface DeliverableFile {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
}

export type DeliveryRung = 'picker' | 'anchor' | 'share';

export interface DeliveryCapabilities {
  picker: boolean;
  anchor: boolean;
  share: boolean;
}

export function detectCapabilities(): DeliveryCapabilities {
  return {
    picker: typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function',
    anchor: typeof document !== 'undefined' && 'download' in document.createElement('a'),
    share: typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function',
  };
}

/** The ladder itself: picker, then anchor, then share — first available wins. */
export function chooseDeliveryRung(caps: DeliveryCapabilities): DeliveryRung | null {
  if (caps.picker) return 'picker';
  if (caps.anchor) return 'anchor';
  if (caps.share) return 'share';
  return null;
}

// showSaveFilePicker rejects with AbortError when the user cancels the save
// dialog — a normal outcome, not a failure worth surfacing as an error.
// Shared by every export control that offers the picker rung.
export function isUserCancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

// ─── Rung 1: showSaveFilePicker + streamed zip ────────────────────────────────

export interface PickerEnv {
  showSaveFilePicker(options: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}

const defaultPickerEnv: PickerEnv = {
  // Only reached once chooseDeliveryRung has confirmed caps.picker, so the
  // browser method is known to exist here.
  showSaveFilePicker: (options) => window.showSaveFilePicker!(options),
};

export async function deliverViaPicker(
  files: DeliverableFile[],
  zipName: string,
  env: PickerEnv = defaultPickerEnv,
): Promise<void> {
  const handle = await env.showSaveFilePicker({
    suggestedName: zipName,
    types: [{ description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }],
  });
  const writable = await handle.createWritable();
  // Cast: FileSystemWritableFileStream.write accepts a wider chunk union
  // than ZipSink asks for; entries here always come from plain,
  // non-shared ArrayBuffers.
  const sink: ZipSink = { write: (chunk) => writable.write(chunk as Uint8Array<ArrayBuffer>) };
  try {
    await writeStoreZip(sink, files.map(f => ({ name: f.name, bytes: f.bytes })));
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => undefined);
    throw e;
  }
}

/** Single-file counterpart to deliverViaPicker — writes the file straight through, no zip. */
export async function deliverViaPickerSingle(
  file: DeliverableFile,
  env: PickerEnv = defaultPickerEnv,
): Promise<void> {
  const handle = await env.showSaveFilePicker({
    suggestedName: file.name,
    types: [{ description: file.mimeType, accept: { [file.mimeType]: [`.${file.name.split('.').pop()}`] } }],
  });
  const writable = await handle.createWritable();
  try {
    await writable.write(file.bytes as Uint8Array<ArrayBuffer>);
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => undefined);
    throw e;
  }
}

// ─── Rung 2: <a download>, sequential ─────────────────────────────────────────

export interface AnchorEnv {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  triggerClick(url: string, filename: string): void;
}

const defaultAnchorEnv: AnchorEnv = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  triggerClick: (url, filename) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  },
};

export async function deliverViaAnchors(
  files: DeliverableFile[],
  env: AnchorEnv = defaultAnchorEnv,
): Promise<void> {
  for (const file of files) {
    const blob = new Blob([file.bytes as BlobPart], { type: file.mimeType });
    const url = env.createObjectURL(blob);
    try {
      env.triggerClick(url, file.name);
    } finally {
      env.revokeObjectURL(url);
    }
  }
}

// ─── Rung 3: navigator.share({ files }) ───────────────────────────────────────

export interface ShareEnv {
  canShare(data: { files: File[] }): boolean;
  share(data: { files: File[] }): Promise<void>;
}

const defaultShareEnv: ShareEnv = {
  canShare: (data) => navigator.canShare(data),
  share: (data) => navigator.share(data),
};

export async function deliverViaShare(
  files: DeliverableFile[],
  env: ShareEnv = defaultShareEnv,
): Promise<void> {
  const shareFiles = files.map(f => new File([f.bytes as BlobPart], f.name, { type: f.mimeType }));
  const data = { files: shareFiles };
  if (!env.canShare(data)) {
    throw new Error('This browser cannot share these files.');
  }
  await env.share(data);
}

// ─── Orchestration ─────────────────────────────────────────────────────────────

export interface DeliverStemsEnv {
  capabilities?: DeliveryCapabilities;
  picker?: PickerEnv;
  anchor?: AnchorEnv;
  share?: ShareEnv;
}

// Picks the rung from `caps` and runs whichever of the three delivery
// callbacks matches — the one piece of ladder logic deliverStems and
// deliverFile below would otherwise each repeat.
async function runLadder(
  caps: DeliveryCapabilities,
  rungs: { picker: () => Promise<void>; anchor: () => Promise<void>; share: () => Promise<void> },
): Promise<DeliveryRung> {
  const rung = chooseDeliveryRung(caps);
  if (rung === 'picker') { await rungs.picker(); return rung; }
  if (rung === 'anchor') { await rungs.anchor(); return rung; }
  if (rung === 'share') { await rungs.share(); return rung; }
  throw new Error('No way to save files is available in this browser.');
}

/** Delivers `files` via the first available rung of the ladder. Returns which rung was used. */
export async function deliverStems(
  files: DeliverableFile[],
  zipName: string,
  env: DeliverStemsEnv = {},
): Promise<DeliveryRung> {
  const caps = env.capabilities ?? detectCapabilities();
  return runLadder(caps, {
    picker: () => deliverViaPicker(files, zipName, env.picker),
    anchor: () => deliverViaAnchors(files, env.anchor),
    share: () => deliverViaShare(files, env.share),
  });
}

/**
 * Delivers a single file via the same three-rung ladder as deliverStems,
 * for Export mix (§6.1): one file needs no zip, so the picker rung writes
 * it straight through and the anchor/share rungs are the existing
 * multi-file paths handed a one-element array.
 */
export async function deliverFile(
  file: DeliverableFile,
  env: DeliverStemsEnv = {},
): Promise<DeliveryRung> {
  const caps = env.capabilities ?? detectCapabilities();
  return runLadder(caps, {
    picker: () => deliverViaPickerSingle(file, env.picker),
    anchor: () => deliverViaAnchors([file], env.anchor),
    share: () => deliverViaShare([file], env.share),
  });
}
