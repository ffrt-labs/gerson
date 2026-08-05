import { describe, it, expect, vi } from 'vitest';
import { ROLES, type Role } from '../../domain/types.ts';
import { createTransport, createTransportEngine, type GainLike, type StretchLike } from '../transport.ts';
import type { ScheduleAnchor } from '../anchor.ts';

// A faithful-enough reimplementation of signalsmith-stretch's own
// schedule() merge (see node_modules/signalsmith-stretch/SignalsmithStretch.mjs,
// the `remoteMethods.schedule` closure) so the sync test below proves
// something real: it independently reconstructs what a live node's *own*
// timeline would resolve to, from nothing but the sequence of schedule()
// calls this instance personally received. If the wrapper ever sent four
// nodes four different anchors, their four independent timelines here would
// disagree — that's exactly the failure §4.2's footgun 1 describes.
type MutableAnchor = { -readonly [K in keyof Required<ScheduleAnchor>]: Required<ScheduleAnchor>[K] };

class SimulatedStretchNode implements StretchLike {
  private timeMap: MutableAnchor[] = [{ output: 0, outputTime: 0, active: false, rate: 1, input: 0 }];
  readonly scheduleCalls: ScheduleAnchor[] = [];

  configure(): void {}
  addBuffers(): Promise<number> {
    return Promise.resolve(0);
  }

  schedule(objIn: ScheduleAnchor): unknown {
    this.scheduleCalls.push(objIn);
    const outputTime = objIn.outputTime;

    let latest = this.timeMap[this.timeMap.length - 1];
    while (this.timeMap.length && this.timeMap[this.timeMap.length - 1].output >= outputTime) {
      latest = this.timeMap.pop()!;
    }

    const obj: MutableAnchor = { ...latest, output: outputTime, input: latest.input };
    Object.assign(obj, objIn);
    if (objIn.input === undefined) {
      const rate = latest.active ? latest.rate : 0;
      obj.input = latest.input + (obj.output - latest.output) * rate;
    }
    this.timeMap.push(obj);
    return Promise.resolve(obj);
  }

  // Mirrors the WASM processor's per-quantum lookup: the segment active as
  // of `atTime`, walked from this instance's own independently-built timeline.
  positionAt(atTime: number): number {
    let segment = this.timeMap[0];
    for (const candidate of this.timeMap) {
      if (candidate.output <= atTime) segment = candidate;
      else break;
    }
    const rate = segment.active ? segment.rate : 0;
    return segment.input + (atTime - segment.output) * rate;
  }
}

function fakeGain(): GainLike {
  return { gain: { value: 1 } };
}

function fourNodes(): Record<Role, SimulatedStretchNode> {
  return {
    vocals: new SimulatedStretchNode(),
    drums: new SimulatedStretchNode(),
    bass: new SimulatedStretchNode(),
    other: new SimulatedStretchNode(),
  };
}

function fourGains(): Record<Role, GainLike> {
  return { vocals: fakeGain(), drums: fakeGain(), bass: fakeGain(), other: fakeGain() };
}

describe('sync — four independently-simulated nodes stay sample-identical', () => {
  it('over a sustained run with repeated rate changes, max |Δ| is exactly 0', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    let t = 0;
    const engine = createTransportEngine(nodes, gains, () => t);

    engine.play();
    const rates = [1, 0.5, 1.8, 0.6, 2, 0.75, 1.25, 0.5, 1, 1.9];
    for (const rate of rates) {
      t += 2.3; // sustained run: each change lands well after the previous one's lookahead
      engine.setRate(rate);
    }
    t += 5;
    engine.pause();

    // Sample throughout the run, including mid-segment and right at
    // scheduled boundaries — not just the final state.
    const sampleTimes: number[] = [];
    for (let sample = 0; sample <= t + 1; sample += 0.37) sampleTimes.push(sample);

    let maxDelta = 0;
    for (const sampleTime of sampleTimes) {
      const positions = ROLES.map(role => nodes[role].positionAt(sampleTime));
      const delta = Math.max(...positions) - Math.min(...positions);
      maxDelta = Math.max(maxDelta, delta);
    }
    expect(maxDelta).toBe(0);
  });

  it('every node receives an identical anchor for every operation', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    let t = 0;
    const engine = createTransportEngine(nodes, gains, () => t);

    engine.play();
    t += 1;
    engine.setRate(0.5);
    t += 1;
    engine.seek(12.5);
    t += 1;
    engine.pause();

    const callCounts = ROLES.map(role => nodes[role].scheduleCalls.length);
    expect(new Set(callCounts).size).toBe(1); // all four got the same number of calls

    const callCount = callCounts[0];
    for (let i = 0; i < callCount; i++) {
      const anchors = ROLES.map(role => nodes[role].scheduleCalls[i]);
      expect(anchors).toEqual(Array(ROLES.length).fill(anchors[0]));
    }
  });
});

describe('footgun 1 — output and outputTime always identical on the wire', () => {
  it('holds across play, setRate, seek, and pause', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    let t = 0;
    const engine = createTransportEngine(nodes, gains, () => t);

    engine.play();
    t += 1;
    engine.setRate(1.5);
    t += 1;
    engine.seek(3);
    t += 1;
    engine.pause();

    for (const call of nodes.vocals.scheduleCalls) {
      expect(call.output).toBe(call.outputTime);
    }
  });
});

describe('footgun 2 — input sent on seek only', () => {
  it('a rate change carries no input field and does not move the playhead', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    let t = 0;
    const engine = createTransportEngine(nodes, gains, () => t);

    engine.play();
    const beforeRateChange = nodes.vocals.positionAt(t + 10);

    t += 1;
    engine.setRate(2);
    const rateChangeCall = nodes.vocals.scheduleCalls.at(-1)!;
    expect(rateChangeCall.input).toBeUndefined();

    const afterRateChange = nodes.vocals.positionAt(t + 10);
    // The playhead formula changes (new rate applies going forward), but the
    // position *at the instant of the change* must not have jumped.
    expect(nodes.vocals.positionAt(t)).toBeCloseTo(beforeRateChange - (10 - 1), 10);
    expect(afterRateChange).not.toBe(beforeRateChange); // sanity: rate did take effect
  });

  it('seek carries an input field equal to the seek target; play/pause/setRate never do', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    let t = 0;
    const engine = createTransportEngine(nodes, gains, () => t);

    engine.play();
    t += 1;
    engine.setRate(1.5);
    t += 1;
    engine.pause();
    t += 1;
    engine.seek(42);

    const calls = nodes.vocals.scheduleCalls;
    expect(calls[0].input).toBeUndefined(); // play
    expect(calls[1].input).toBeUndefined(); // setRate
    expect(calls[2].input).toBeUndefined(); // pause
    expect(calls[3].input).toBe(42); // seek
  });
});

describe('gain and mute — trivially live, independent of the stretch timeline', () => {
  it('setGain writes straight through to the GainNode', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    const engine = createTransportEngine(nodes, gains, () => 0);

    engine.setGain('drums', 0.3);
    expect(gains.drums.gain.value).toBe(0.3);
    expect(nodes.drums.scheduleCalls.length).toBe(0); // no stretcher round-trip involved
  });

  it('setMuted zeroes the gain and restores the prior value on unmute', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    const engine = createTransportEngine(nodes, gains, () => 0);

    engine.setGain('bass', 0.8);
    engine.setMuted('bass', true);
    expect(gains.bass.gain.value).toBe(0);

    engine.setMuted('bass', false);
    expect(gains.bass.gain.value).toBe(0.8);
  });
});

describe('createTransport — node setup', () => {
  it('configures splitComputation:true and feeds each stem in exactly one addBuffers call, which detaches the source buffers', async () => {
    const configureCalls: Array<{ splitComputation: boolean }> = [];
    const addBuffersCalls: Array<{ role: Role; buffers: Float32Array[]; transfer?: ArrayBuffer[] }> = [];
    const connected: unknown[] = [];

    function makeFakeNode(role: Role) {
      return {
        configure: vi.fn(async (config: { splitComputation: boolean }) => {
          configureCalls.push(config);
        }),
        schedule: vi.fn(),
        addBuffers: vi.fn(async (buffers: Float32Array[], transfer?: ArrayBuffer[]) => {
          addBuffersCalls.push({ role, buffers, transfer });
          if (transfer) structuredClone(buffers, { transfer });
          return buffers[0]?.length ?? 0;
        }),
        connect: vi.fn((dest: unknown) => connected.push(dest)),
        disconnect: vi.fn(),
      };
    }

    const fakeGainNode = () => ({
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    const fakeAudioContext = {
      currentTime: 0,
      createGain: vi.fn(fakeGainNode),
      destination: {},
    };

    // createTransport iterates ROLES sequentially, awaiting each node's
    // creation before the next — so call order exactly matches ROLES order.
    let callIndex = 0;
    const createNode = vi.fn(async () => makeFakeNode(ROLES[callIndex++]));

    // Build one stem per role with a fresh, detachable Float32Array.
    const stems = Object.fromEntries(
      ROLES.map(role => [role, { channels: [new Float32Array([1, 2, 3, 4])] }]),
    ) as Record<Role, { channels: Float32Array[] }>;
    const originalBuffers = ROLES.map(role => stems[role].channels[0].buffer);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createTransport(fakeAudioContext as any, stems, createNode as any);

    expect(configureCalls).toEqual(ROLES.map(() => ({ splitComputation: true })));
    expect(addBuffersCalls.length).toBe(ROLES.length);
    for (const role of ROLES) {
      const callsForRole = addBuffersCalls.filter(c => c.role === role);
      expect(callsForRole.length).toBe(1); // exactly one addBuffers call per stem
    }
    for (const buffer of originalBuffers) {
      expect(buffer.byteLength).toBe(0); // the source ArrayBuffer detached
    }
  });
});
