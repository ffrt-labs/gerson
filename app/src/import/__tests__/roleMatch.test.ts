import { describe, it, expect } from 'vitest';
import { prefillRoles } from '../roleMatch.ts';

describe('prefillRoles', () => {
  it('prefills our own export filename convention ("<title> - <role>.<ext>")', () => {
    const names = ['My Song - vocals.flac', 'My Song - drums.flac', 'My Song - bass.flac', 'My Song - other.flac'];
    expect(prefillRoles(names)).toEqual(['vocals', 'drums', 'bass', 'other']);
  });

  it('prefills Demucs CLI / Spleeter bare-role filenames', () => {
    const names = ['vocals.wav', 'drums.wav', 'bass.wav', 'other.wav'];
    expect(prefillRoles(names)).toEqual(['vocals', 'drums', 'bass', 'other']);
  });

  it('prefills regardless of input order', () => {
    const names = ['bass.wav', 'other.wav', 'vocals.wav', 'drums.wav'];
    expect(prefillRoles(names)).toEqual(['bass', 'other', 'vocals', 'drums']);
  });

  it('is case-insensitive', () => {
    const names = ['VOCALS.WAV', 'Drums.wav', 'Bass.WAV', 'OTHER.wav'];
    expect(prefillRoles(names)).toEqual(['vocals', 'drums', 'bass', 'other']);
  });

  it('recognises common synonyms (vox, instrumental)', () => {
    const names = ['track_vox.wav', 'track_drums.wav', 'track_bass.wav', 'track_instrumental.wav'];
    expect(prefillRoles(names)).toEqual(['vocals', 'drums', 'bass', 'other']);
  });

  it('prefills nothing when one filename matches no role', () => {
    const names = ['vocals.wav', 'drums.wav', 'bass.wav', 'guitar.wav'];
    expect(prefillRoles(names)).toEqual([null, null, null, null]);
  });

  it('prefills nothing when one filename is ambiguous between two roles', () => {
    const names = ['vocals.wav', 'drums.wav', 'bass.wav', 'other_vocals.wav'];
    expect(prefillRoles(names)).toEqual([null, null, null, null]);
  });

  it('prefills nothing when two filenames match the same role', () => {
    const names = ['vocals.wav', 'vocals (1).wav', 'bass.wav', 'other.wav'];
    expect(prefillRoles(names)).toEqual([null, null, null, null]);
  });

  it('prefills nothing for a generic set with no role hints at all', () => {
    const names = ['track1.wav', 'track2.wav', 'track3.wav', 'track4.wav'];
    expect(prefillRoles(names)).toEqual([null, null, null, null]);
  });

  it('prefills nothing when given fewer than four names', () => {
    const names = ['vocals.wav', 'drums.wav', 'bass.wav'];
    expect(prefillRoles(names)).toEqual([null, null, null]);
  });
});
