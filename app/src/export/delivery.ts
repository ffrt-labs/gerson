/**
 * The delivery ladder (§6.1): showSaveFilePicker (Chromium only) streams a
 * STORE-only zip straight into the save dialog → <a download> falls back to
 * four sequential downloads, the universal floor → navigator.share({files})
 * covers whatever's left, chiefly mobile contexts where a plain download
 * doesn't really land anywhere the user can find it.
 *
 * Each rung is a thin, individually-injectable wrapper around a browser
 * API, so the ladder's *choice* of rung is unit-testable without a DOM.
 */

import type { ExportedFile } from './exportStems.ts';
import { writeStoreZip, type ZipSink } from './zip.ts';

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
  files: ExportedFile[],
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
  files: ExportedFile[],
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
  files: ExportedFile[],
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

/** Delivers `files` via the first available rung of the ladder. Returns which rung was used. */
export async function deliverStems(
  files: ExportedFile[],
  zipName: string,
  env: DeliverStemsEnv = {},
): Promise<DeliveryRung> {
  const caps = env.capabilities ?? detectCapabilities();
  const rung = chooseDeliveryRung(caps);

  if (rung === 'picker') {
    await deliverViaPicker(files, zipName, env.picker);
    return rung;
  }
  if (rung === 'anchor') {
    await deliverViaAnchors(files, env.anchor);
    return rung;
  }
  if (rung === 'share') {
    await deliverViaShare(files, env.share);
    return rung;
  }

  throw new Error('No way to save files is available in this browser.');
}
