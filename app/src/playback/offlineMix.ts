/**
 * Export mix's apply-tempo path (§4.7, §6.1): the stretcher rendered once,
 * offline, at the Practice state's tempo — the same engine and the same
 * schedule() anchor shape as live playback (§4.2), so what lands in the
 * file matches what was in your ears. `OfflineAudioContext` runs this at
 * ~80× realtime, which is what makes export-with-tempo cheap enough to ship.
 *
 * Unlike the live Transport, there is no cross-node sync to preserve here —
 * this produces one summed file, not four independently mutable stems — so
 * a silent (zero-gain: muted, or excluded by a solo) stem is skipped
 * entirely rather than fed through a node at gain 0.
 */

import SignalsmithStretch from 'signalsmith-stretch';
import type { StretchNode } from 'signalsmith-stretch';
import type { Role } from '../domain/types.ts';
import { ROLES } from '../domain/types.ts';
import { SAMPLE_RATE } from '../codec/flac.ts';

export interface OfflineMixStem {
  /** Decoded, full-length stereo PCM for this Role — never pre-sliced to a region; `startSec` does that. */
  channels: Float32Array[];
  /** Already resolved: 0 when muted or excluded by a solo (see export/exportMix.ts's appliedGain). */
  gain: number;
}

export interface RenderMixOfflineOptions {
  tempo: number;
  /** Absolute input-buffer position (seconds) to start reading from — the loop start, or 0. */
  startSec: number;
  /** Input-buffer duration (seconds) to render — the loop length, or the whole Song. */
  durationSec: number;
}

export type CreateOfflineStretchNode = (
  audioContext: OfflineAudioContext,
  options: { numberOfInputs: number; numberOfOutputs: number; outputChannelCount: number[] },
) => Promise<StretchNode>;

export type CreateOfflineAudioContext = (
  numberOfChannels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

const defaultCreateOfflineAudioContext: CreateOfflineAudioContext =
  (numberOfChannels, length, sampleRate) => new OfflineAudioContext(numberOfChannels, length, sampleRate);

/**
 * Renders `stems` mixed together through the stretcher at `options.tempo`.
 * Output length is `durationSec / tempo` seconds — rate is input-seconds
 * per output-second (§4.2/anchor.ts), so slowing down takes longer to
 * render through, exactly as it takes longer to listen to.
 */
export async function renderMixOffline(
  stems: Record<Role, OfflineMixStem>,
  options: RenderMixOfflineOptions,
  createNode: CreateOfflineStretchNode = SignalsmithStretch,
  createContext: CreateOfflineAudioContext = defaultCreateOfflineAudioContext,
): Promise<Float32Array[]> {
  const { tempo, startSec, durationSec } = options;
  const outputSamples = Math.max(1, Math.round((durationSec / tempo) * SAMPLE_RATE));
  const context = createContext(2, outputSamples, SAMPLE_RATE);

  for (const role of ROLES) {
    const { channels, gain } = stems[role];
    if (gain === 0) continue;

    const node = await createNode(context, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    await node.configure({ splitComputation: true });
    await node.addBuffers(channels.map(c => c.slice()));

    const gainNode = context.createGain();
    gainNode.gain.value = gain;
    node.connect(gainNode);
    gainNode.connect(context.destination);

    // Same anchor shape §4.2 requires live: output and outputTime identical
    // (both 0 — the render's own time zero), input present because this is
    // an absolute seek to the render's start.
    await node.schedule({ active: true, input: startSec, rate: tempo, outputTime: 0, output: 0 });
  }

  const rendered = await context.startRendering();
  return [rendered.getChannelData(0), rendered.getChannelData(1)];
}
