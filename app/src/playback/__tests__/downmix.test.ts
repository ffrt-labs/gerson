import { describe, it, expect } from 'vitest';
import { downmixToMono } from '../downmix.ts';

describe('downmixToMono', () => {
  it('averages left and right sample-by-sample', () => {
    const left = new Float32Array([1, 0.5, -1, 0]);
    const right = new Float32Array([0, 0.5, -1, 1]);
    const mono = downmixToMono(left, right);
    expect(Array.from(mono)).toEqual([0.5, 0.5, -1, 0.5]);
  });

  it('returns a Float32Array the same length as the input channels', () => {
    const left = new Float32Array(1000);
    const right = new Float32Array(1000);
    expect(downmixToMono(left, right)).toHaveLength(1000);
  });

  it('is a standalone copy, not a view into either input channel', () => {
    const left = new Float32Array([1, 1]);
    const right = new Float32Array([1, 1]);
    const mono = downmixToMono(left, right);
    left[0] = 99;
    expect(mono[0]).toBe(1);
  });
});
