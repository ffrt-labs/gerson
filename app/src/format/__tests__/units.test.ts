import { describe, it, expect } from 'vitest';
import {
  formatTimecode,
  formatClock,
  formatLengthSec,
  formatRate,
  formatGain,
  formatDiskSize,
  formatMegabytes,
} from '../units.ts';

describe('formatTimecode', () => {
  it('renders m:ss.hh, the transport readout', () => {
    expect(formatTimecode(41.2)).toBe('0:41.20');
    expect(formatTimecode(214)).toBe('3:34.00');
  });

  it('pads the seconds but never the minutes', () => {
    expect(formatTimecode(5.5)).toBe('0:05.50');
    expect(formatTimecode(605)).toBe('10:05.00');
  });

  // The playhead is legitimately negative during the first output-latency
  // window after Play (#87) — the readout must not show "-1:59.-8".
  it('floors a negative position at zero', () => {
    expect(formatTimecode(-0.3)).toBe('0:00.00');
  });

  it('carries hundredths that round up into the next second', () => {
    expect(formatTimecode(59.999)).toBe('1:00.00');
  });

  it('renders a non-finite position as zero rather than NaN', () => {
    expect(formatTimecode(NaN)).toBe('0:00.00');
    expect(formatTimecode(Infinity)).toBe('0:00.00');
  });
});

describe('formatClock', () => {
  it('renders m:ss, the meta line duration', () => {
    expect(formatClock(214)).toBe('3:34');
    expect(formatClock(258)).toBe('4:18');
    expect(formatClock(0)).toBe('0:00');
  });

  it('rounds to the nearest second without ever showing :60', () => {
    expect(formatClock(59.7)).toBe('1:00');
  });
});

describe('formatLengthSec', () => {
  it('renders a loop length with two decimals and a unit', () => {
    expect(formatLengthSec(17.8)).toBe('17.80s');
  });
});

describe('formatRate', () => {
  // Tempo is always a multiplier, never BPM (CONTEXT.md glossary).
  it('renders a tempo multiplier with the multiplication sign', () => {
    expect(formatRate(0.85)).toBe('0.85×');
    expect(formatRate(1)).toBe('1.00×');
  });
});

describe('formatGain', () => {
  it('renders a gain with two decimals', () => {
    expect(formatGain(1)).toBe('1.00');
    expect(formatGain(0.5)).toBe('0.50');
  });
});

describe('formatDiskSize', () => {
  it('uses MB below a gigabyte and GB above it', () => {
    expect(formatDiskSize(1.4 * 1024 ** 3)).toBe('1.4 GB');
    expect(formatDiskSize(340 * 1024 ** 2)).toBe('340 MB');
  });

  it('never shows a bare 0.0 GB for a small library', () => {
    expect(formatDiskSize(0)).toBe('0 MB');
    expect(formatDiskSize(1024)).toBe('0 MB');
  });
});

describe('formatMegabytes', () => {
  it('renders whole megabytes, for the model download readout', () => {
    expect(formatMegabytes(51 * 1024 * 1024)).toBe('51');
    expect(formatMegabytes(80 * 1024 * 1024)).toBe('80');
  });
});
