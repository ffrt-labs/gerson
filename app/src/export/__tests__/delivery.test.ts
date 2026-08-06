import { describe, it, expect, vi } from 'vitest';
import {
  chooseDeliveryRung,
  deliverStems,
  deliverViaPicker,
  deliverViaAnchors,
  deliverViaShare,
  type DeliveryCapabilities,
  type PickerEnv,
  type AnchorEnv,
  type ShareEnv,
} from '../delivery.ts';
import type { ExportedFile } from '../exportStems.ts';

const FILES: ExportedFile[] = [
  { role: 'vocals', name: 'Song - vocals.flac', bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/flac' },
  { role: 'drums', name: 'Song - drums.flac', bytes: new Uint8Array([4, 5, 6]), mimeType: 'audio/flac' },
  { role: 'bass', name: 'Song - bass.flac', bytes: new Uint8Array([7, 8, 9]), mimeType: 'audio/flac' },
  { role: 'other', name: 'Song - other.flac', bytes: new Uint8Array([10, 11, 12]), mimeType: 'audio/flac' },
];

const NONE: DeliveryCapabilities = { picker: false, anchor: false, share: false };

describe('chooseDeliveryRung', () => {
  it('prefers picker over anchor and share', () => {
    expect(chooseDeliveryRung({ picker: true, anchor: true, share: true })).toBe('picker');
  });

  it('falls back to anchor when picker is unavailable', () => {
    expect(chooseDeliveryRung({ picker: false, anchor: true, share: true })).toBe('anchor');
  });

  it('falls back to share when only share is available', () => {
    expect(chooseDeliveryRung({ picker: false, anchor: false, share: true })).toBe('share');
  });

  it('returns null when nothing is available', () => {
    expect(chooseDeliveryRung(NONE)).toBeNull();
  });
});

describe('deliverViaPicker', () => {
  it('writes a zip containing all four files through the returned writable', async () => {
    const written: Uint8Array[] = [];
    let closed = false;
    const env: PickerEnv = {
      showSaveFilePicker: vi.fn(async (options) => {
        expect(options.suggestedName).toBe('Song.zip');
        return {
          createWritable: async () => ({
            write: async (chunk: Uint8Array) => { written.push(chunk); },
            close: async () => { closed = true; },
            abort: async () => {},
          }),
        } as unknown as FileSystemFileHandle;
      }),
    };

    await deliverViaPicker(FILES, 'Song.zip', env);

    expect(closed).toBe(true);
    const total = written.reduce((n, c) => n + c.length, 0);
    expect(total).toBeGreaterThan(0);

    // The written stream is a real zip — decode its EOCD entry count.
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of written) { all.set(c, off); off += c.length; }
    const view = new DataView(all.buffer);
    expect(view.getUint16(all.length - 22 + 10, true)).toBe(4);
  });

  it('aborts the writable and rethrows when writing fails', async () => {
    let aborted = false;
    const env: PickerEnv = {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async () => { throw new Error('disk full'); },
          close: async () => {},
          abort: async () => { aborted = true; },
        }),
      } as unknown as FileSystemFileHandle),
    };

    await expect(deliverViaPicker(FILES, 'Song.zip', env)).rejects.toThrow('disk full');
    expect(aborted).toBe(true);
  });
});

describe('deliverViaAnchors', () => {
  it('triggers one download per file, in order, and revokes each URL', async () => {
    const clicks: string[] = [];
    const revoked: string[] = [];
    let urlCounter = 0;
    const env: AnchorEnv = {
      createObjectURL: () => `blob:${urlCounter++}`,
      revokeObjectURL: (url) => { revoked.push(url); },
      triggerClick: (url, filename) => { clicks.push(`${filename}@${url}`); },
    };

    await deliverViaAnchors(FILES, env);

    expect(clicks).toEqual([
      'Song - vocals.flac@blob:0',
      'Song - drums.flac@blob:1',
      'Song - bass.flac@blob:2',
      'Song - other.flac@blob:3',
    ]);
    expect(revoked).toEqual(['blob:0', 'blob:1', 'blob:2', 'blob:3']);
  });
});

describe('deliverViaShare', () => {
  it('shares all files together when the browser can', async () => {
    let sharedFiles: File[] | null = null;
    const env: ShareEnv = {
      canShare: () => true,
      share: async (data) => { sharedFiles = data.files; },
    };

    await deliverViaShare(FILES, env);

    expect(sharedFiles).toHaveLength(4);
    expect(sharedFiles![0].name).toBe('Song - vocals.flac');
  });

  it('throws rather than calling share when canShare refuses', async () => {
    const share = vi.fn();
    const env: ShareEnv = { canShare: () => false, share };

    await expect(deliverViaShare(FILES, env)).rejects.toThrow();
    expect(share).not.toHaveBeenCalled();
  });
});

describe('deliverStems', () => {
  it('routes to the picker rung when capabilities allow it', async () => {
    let pickerCalled = false;
    await deliverStems(FILES, 'Song.zip', {
      capabilities: { picker: true, anchor: true, share: true },
      picker: {
        showSaveFilePicker: async () => {
          pickerCalled = true;
          return {
            createWritable: async () => ({
              write: async () => {},
              close: async () => {},
              abort: async () => {},
            }),
          } as unknown as FileSystemFileHandle;
        },
      },
    });
    expect(pickerCalled).toBe(true);
  });

  it('routes to the anchor rung when only it and share are available', async () => {
    let anchorCalls = 0;
    const rung = await deliverStems(FILES, 'Song.zip', {
      capabilities: { picker: false, anchor: true, share: true },
      anchor: {
        createObjectURL: () => 'blob:x',
        revokeObjectURL: () => {},
        triggerClick: () => { anchorCalls++; },
      },
    });
    expect(rung).toBe('anchor');
    expect(anchorCalls).toBe(4);
  });

  it('routes to the share rung as the last resort', async () => {
    const rung = await deliverStems(FILES, 'Song.zip', {
      capabilities: { picker: false, anchor: false, share: true },
      shareEnv: { canShare: () => true, share: async () => {} },
    });
    expect(rung).toBe('share');
  });

  it('rejects when no rung is available', async () => {
    await expect(deliverStems(FILES, 'Song.zip', { capabilities: NONE })).rejects.toThrow();
  });
});
