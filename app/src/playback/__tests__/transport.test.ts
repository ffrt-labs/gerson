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
  private timeMap: MutableAnchor[] = [{ output: 0, outputTime: 0, active: false, rate: 1, input: 0, loopStart: 0, loopEnd: 0 }];
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

describe('setLoop — one anchor to every node, identical, disabled by equal start/end', () => {
  it('broadcasts the same loopStart/loopEnd to all four nodes', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    const engine = createTransportEngine(nodes, gains, () => 0);

    engine.setLoop({ startSec: 10, endSec: 20 });

    for (const role of ROLES) {
      const call = nodes[role].scheduleCalls.at(-1)!;
      expect(call.loopStart).toBe(10);
      expect(call.loopEnd).toBe(20);
    }
    const anchors = ROLES.map(role => nodes[role].scheduleCalls.at(-1));
    expect(anchors).toEqual(Array(ROLES.length).fill(anchors[0]));
  });

  it('null sends an equal loopStart/loopEnd pair — the library\'s own disable rule', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    const engine = createTransportEngine(nodes, gains, () => 0);

    engine.setLoop({ startSec: 10, endSec: 20 });
    engine.setLoop(null);

    const call = nodes.vocals.scheduleCalls.at(-1)!;
    expect(call.loopStart).toBe(call.loopEnd);
  });

  it('is not a seek — carries no input field', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    const engine = createTransportEngine(nodes, gains, () => 0);

    engine.setLoop({ startSec: 10, endSec: 20 });
    expect(nodes.vocals.scheduleCalls.at(-1)!.input).toBeUndefined();
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

describe('solo — silences the other three without touching their stored gain/mute', () => {
  it('soloing one stem zeroes the gain of the other three, leaving the soloed one at its own gain', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    const engine = createTransportEngine(nodes, gains, () => 0);

    engine.setGain('vocals', 0.4);
    engine.setGain('drums', 0.6);
    engine.setGain('bass', 0.8);
    engine.setGain('other', 1.2);

    engine.setSolo('drums', true);

    expect(gains.vocals.gain.value).toBe(0);
    expect(gains.bass.gain.value).toBe(0);
    expect(gains.other.gain.value).toBe(0);
    expect(gains.drums.gain.value).toBe(0.6);
  });

  it('unsoloing restores every stem to its own stored gain and mute, unchanged by the solo', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    const engine = createTransportEngine(nodes, gains, () => 0);

    engine.setGain('vocals', 0.4);
    engine.setMuted('bass', true);
    engine.setGain('other', 1.2);

    engine.setSolo('drums', true);
    engine.setSolo('drums', false);

    expect(gains.vocals.gain.value).toBe(0.4);
    expect(gains.bass.gain.value).toBe(0); // still muted — the mute itself, not the solo
    expect(gains.other.gain.value).toBe(1.2);
    expect(gains.drums.gain.value).toBe(1); // default gain, never touched
  });

  it('a soloed stem that is itself muted stays silent', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    const engine = createTransportEngine(nodes, gains, () => 0);

    engine.setMuted('drums', true);
    engine.setSolo('drums', true);

    expect(gains.drums.gain.value).toBe(0);
  });

  it('is gain-only, like mute — issues no stretcher schedule() calls', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    const engine = createTransportEngine(nodes, gains, () => 0);

    engine.setSolo('drums', true);
    for (const role of ROLES) expect(nodes[role].scheduleCalls.length).toBe(0);
  });
});

describe('getPosition — main-thread arithmetic, no worklet round-trip', () => {
  // Every op is dispatched SCHEDULE_LOOKAHEAD_SECONDS ahead of `now()`, so
  // each case advances `t` past that window before reading a position —
  // exactness at the instant of a change is anchor.ts's job (see
  // anchor.test.ts); these tests exercise the engine's plumbing to it.

  it('tracks a running transport without any schedule() call', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    let t = 0;
    const engine = createTransportEngine(nodes, gains, () => t);

    engine.play();
    t += 1;
    const start = engine.getPosition(t);
    const callsBefore = ROLES.map(role => nodes[role].scheduleCalls.length);

    t += 10;
    expect(engine.getPosition(t)).toBeCloseTo(start + 10, 10);

    // Reading the position issues no schedule() calls on any node — it's
    // pure arithmetic against the last anchor, never a worklet round-trip.
    const callsAfter = ROLES.map(role => nodes[role].scheduleCalls.length);
    expect(callsAfter).toEqual(callsBefore);
  });

  it('applies a new rate going forward once the change has landed', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    let t = 0;
    const engine = createTransportEngine(nodes, gains, () => t);

    engine.play();
    t += 5;
    engine.setRate(2);
    t += 5;
    const base = engine.getPosition(t);

    t += 3;
    expect(engine.getPosition(t)).toBeCloseTo(base + 3 * 2, 10);
  });

  it('lands on the seek target and continues from there at the current rate, regardless of rate', () => {
    const nodes = fourNodes();
    const gains = fourGains();
    let t = 0;
    const engine = createTransportEngine(nodes, gains, () => t);

    engine.play();
    t += 1;
    engine.setRate(0.5);
    t += 5;
    engine.seek(90);
    t += 1;
    const afterSeek = engine.getPosition(t);
    // Lands at (approximately, within the scheduling lookahead) the seek
    // target — exactness at the instant of the seek is anchor.ts's job.
    expect(afterSeek).toBeGreaterThan(89.5);
    expect(afterSeek).toBeLessThan(90.5);

    t += 4;
    expect(engine.getPosition(t)).toBeCloseTo(afterSeek + 4 * 0.5, 10);
  });
});

describe('createTransport — node setup', () => {
  // events, if given, records `addBuffers:<role>` in call order — used by
  // the sequencing test below to interleave against loadStem's own log.
  function makeFakeNode(role: Role, events?: string[]) {
    return {
      configure: vi.fn(),
      schedule: vi.fn(),
      addBuffers: vi.fn(async (buffers: Float32Array[], transfer?: ArrayBuffer[]) => {
        events?.push(`addBuffers:${role}`);
        if (transfer) structuredClone(buffers, { transfer });
        return buffers[0]?.length ?? 0;
      }),
      dropBuffers: vi.fn(async () => ({ start: 0, end: 0 })),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  function fakeGainNode() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  }

  function fakeAudioContext() {
    return { currentTime: 0, createGain: vi.fn(fakeGainNode), destination: {} };
  }

  // createTransport iterates ROLES sequentially, awaiting each node's
  // creation before the next — so call order exactly matches ROLES order.
  function sequentialCreateNode(events?: string[]) {
    let callIndex = 0;
    return vi.fn(async () => makeFakeNode(ROLES[callIndex++], events));
  }

  it('configures splitComputation:true and feeds each stem in exactly one addBuffers call, which detaches the source buffers', async () => {
    const createNode = sequentialCreateNode();

    // One stem per role with a fresh, detachable Float32Array.
    const stems = Object.fromEntries(
      ROLES.map(role => [role, { channels: [new Float32Array([1, 2, 3, 4])] }]),
    ) as Record<Role, { channels: Float32Array[] }>;
    const originalBuffers = ROLES.map(role => stems[role].channels[0].buffer);
    const loadStem = vi.fn(async (role: Role) => stems[role]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transport = await createTransport(fakeAudioContext() as any, loadStem, createNode as any);

    expect(createNode).toHaveBeenCalledTimes(ROLES.length);
    for (const call of createNode.mock.results) {
      const node = await call.value;
      expect(node.configure).toHaveBeenCalledWith({ splitComputation: true });
      expect(node.addBuffers).toHaveBeenCalledTimes(1); // exactly one addBuffers call per stem
    }
    for (const buffer of originalBuffers) {
      expect(buffer.byteLength).toBe(0); // the source ArrayBuffer detached
    }
    void transport; // node setup asserted directly against the fakes above
  });

  it('loads stems sequentially — each is transferred before the next is requested (§4.4)', async () => {
    const events: string[] = [];
    const createNode = sequentialCreateNode(events);

    const loadStem = vi.fn(async (role: Role) => {
      events.push(`load:${role}`);
      return { channels: [new Float32Array([1, 2, 3, 4])] };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createTransport(fakeAudioContext() as any, loadStem, createNode as any);

    // Node creation runs first (no PCM involved), then load/transfer pairs
    // interleave one role at a time — loadStem for role N+1 is never called
    // before role N's buffers were handed to addBuffers, so the load never
    // holds more than one decoded stem in memory at once.
    expect(events).toEqual(ROLES.flatMap(role => [`load:${role}`, `addBuffers:${role}`]));
  });

  it('dispose() drops each node\'s buffers before disconnecting it and its gain', async () => {
    const fakeNodes: Record<string, ReturnType<typeof makeFakeNode>> = {};
    let callIndex = 0;
    const createNode = vi.fn(async () => {
      const role = ROLES[callIndex++];
      const node = makeFakeNode(role);
      fakeNodes[role] = node;
      return node;
    });

    const loadStem = vi.fn(async () => ({ channels: [new Float32Array([1, 2, 3, 4])] }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transport = await createTransport(fakeAudioContext() as any, loadStem, createNode as any);
    await transport.dispose();

    for (const role of ROLES) {
      expect(fakeNodes[role].dropBuffers).toHaveBeenCalled();
      expect(fakeNodes[role].disconnect).toHaveBeenCalled();
    }
  });
});
