import { describe, it, expect } from 'vitest';
import { detectMimeType } from '../decode.ts';

describe('detectMimeType', () => {
  it('identifies MP3 by an ID3 tag header', () => {
    expect(detectMimeType(new Uint8Array([0x49, 0x44, 0x33, 0, 0]))).toBe('audio/mpeg');
  });

  it('identifies MP3 by a frame sync header (no ID3 tag)', () => {
    expect(detectMimeType(new Uint8Array([0xff, 0xfb, 0, 0]))).toBe('audio/mpeg');
  });

  it('identifies FLAC', () => {
    expect(detectMimeType(new Uint8Array([0x66, 0x4c, 0x61, 0x43]))).toBe('audio/flac');
  });

  it('identifies OGG', () => {
    expect(detectMimeType(new Uint8Array([0x4f, 0x67, 0x67, 0x53]))).toBe('audio/ogg');
  });

  it('identifies WAV by its RIFF header', () => {
    expect(detectMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe('audio/wav');
  });

  it('falls back to a generic octet-stream for unrecognised headers', () => {
    expect(detectMimeType(new Uint8Array([0, 1, 2, 3]))).toBe('application/octet-stream');
  });
});
