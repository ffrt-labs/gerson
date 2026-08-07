import { describe, it, expect, vi } from 'vitest';
import { ROLES, type Role } from '../../domain/types.ts';
import { renderMixOffline, type OfflineMixStem } from '../offlineMix.ts';

function makeFakeNode() {
  return {
    configure: vi.fn(),
    addBuffers: vi.fn(async () => 0),
    schedule: vi.fn(async () => ({})),
    connect: vi.fn(),
  };
}

function fakeGainNode() {
  return { gain: { value: 1 }, connect: vi.fn() };
}

function fakeContext(renderedChannels: [Float32Array, Float32Array]) {
  const gains: ReturnType<typeof fakeGainNode>[] = [];
  return {
    createGain: vi.fn(() => {
      const g = fakeGainNode();
      gains.push(g);
      return g;
    }),
    destination: {},
    startRendering: vi.fn(async () => ({
      getChannelData: (ch: number) => renderedChannels[ch],
    })),
    gains,
  };
}

function stemsAllGain(gain = 1, length = 8): Record<Role, OfflineMixStem> {
  return Object.fromEntries(
    ROLES.map(role => [role, { channels: [new Float32Array(length).fill(1), new Float32Array(length).fill(1)], gain }]),
  ) as Record<Role, OfflineMixStem>;
}

describe('renderMixOffline', () => {
  it('sizes the offline context to durationSec/tempo seconds of output at 44100', async () => {
    const createNode = vi.fn(async () => makeFakeNode());
    const context = fakeContext([new Float32Array(4), new Float32Array(4)]);
    const createContext = vi.fn(() => context);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await renderMixOffline(stemsAllGain(), { tempo: 0.5, startSec: 0, durationSec: 10 }, createNode as any, createContext as any);

    // 10s of input at 0.5x rate takes 20s to render through.
    expect(createContext).toHaveBeenCalledWith(2, 20 * 44100, 44100);
  });

  it('schedules every non-silent node with the same anchor: input=startSec, rate=tempo, output/outputTime=0', async () => {
    const nodes: ReturnType<typeof makeFakeNode>[] = [];
    const createNode = vi.fn(async () => {
      const n = makeFakeNode();
      nodes.push(n);
      return n;
    });
    const context = fakeContext([new Float32Array(4), new Float32Array(4)]);
    const createContext = vi.fn(() => context);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await renderMixOffline(stemsAllGain(), { tempo: 0.75, startSec: 12.5, durationSec: 4 }, createNode as any, createContext as any);

    expect(nodes).toHaveLength(4);
    for (const node of nodes) {
      expect(node.configure).toHaveBeenCalledWith({ splitComputation: true });
      expect(node.schedule).toHaveBeenCalledWith({ active: true, input: 12.5, rate: 0.75, outputTime: 0, output: 0 });
    }
  });

  it("sets each node's gain to the stem's resolved gain and routes it to the destination", async () => {
    const createNode = vi.fn(async () => makeFakeNode());
    const context = fakeContext([new Float32Array(4), new Float32Array(4)]);
    const createContext = vi.fn(() => context);

    const stems = stemsAllGain();
    stems.drums.gain = 0.3;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await renderMixOffline(stems, { tempo: 1, startSec: 0, durationSec: 4 }, createNode as any, createContext as any);

    // ROLES order is vocals, drums, bass, other — all four non-silent, so
    // the gain nodes were created in that order.
    expect(context.gains.map(g => g.gain.value)).toEqual([1, 0.3, 1, 1]);
    for (const g of context.gains) expect(g.connect).toHaveBeenCalledWith(context.destination);
  });

  it('skips creating a node entirely for a fully silent (gain 0) stem', async () => {
    const createNode = vi.fn(async () => makeFakeNode());
    const context = fakeContext([new Float32Array(4), new Float32Array(4)]);
    const createContext = vi.fn(() => context);

    const stems = stemsAllGain();
    stems.bass.gain = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await renderMixOffline(stems, { tempo: 1, startSec: 0, durationSec: 4 }, createNode as any, createContext as any);

    expect(createNode).toHaveBeenCalledTimes(3);
  });

  it('feeds each node exactly one addBuffers call', async () => {
    const nodes: ReturnType<typeof makeFakeNode>[] = [];
    const createNode = vi.fn(async () => {
      const n = makeFakeNode();
      nodes.push(n);
      return n;
    });
    const context = fakeContext([new Float32Array(4), new Float32Array(4)]);
    const createContext = vi.fn(() => context);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await renderMixOffline(stemsAllGain(), { tempo: 1, startSec: 0, durationSec: 4 }, createNode as any, createContext as any);

    for (const node of nodes) expect(node.addBuffers).toHaveBeenCalledTimes(1);
  });

  it('returns the two channels startRendering produced', async () => {
    const createNode = vi.fn(async () => makeFakeNode());
    const rendered: [Float32Array, Float32Array] = [new Float32Array([1, 2]), new Float32Array([3, 4])];
    const context = fakeContext(rendered);
    const createContext = vi.fn(() => context);

    const result = await renderMixOffline(
      stemsAllGain(),
      { tempo: 1, startSec: 0, durationSec: 4 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createNode as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createContext as any,
    );

    expect(result[0]).toBe(rendered[0]);
    expect(result[1]).toBe(rendered[1]);
  });
});
