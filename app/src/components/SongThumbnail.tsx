import { useEffect, useMemo, useState } from 'react';
import type { Song } from '../domain/types.ts';
import { ROLES } from '../domain/types.ts';
import { loadSongPeaks } from '../waveform/loadPeaks.ts';
import { mixPeaks } from '../waveform/mix.ts';
import { WaveformCanvas } from './WaveformCanvas.tsx';
import { WAVE_NEUTRAL } from '../waveform/colors.ts';
import { fitTheSongViewport } from '../waveform/viewport.ts';
import { useInView } from '../hooks/useInView.ts';
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio.ts';

const THUMBNAIL_WIDTH_PX = 180;
const THUMBNAIL_HEIGHT_PX = 34;

// Peaks are read once per Song per session and shared across every row that
// asks — a library re-render (a rename, a job progress tick) must not
// re-read four files off OPFS.
const cache = new Map<string, Int8Array>();

// The waveform silhouette on a library row. Reading four peaks files is
// cheap per Song but not free across a large library, so it waits until the
// row is near the viewport (useInView) and never repeats.
export function SongThumbnail({ song }: { song: Song }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [peaks, setPeaks] = useState<Int8Array | null>(() => cache.get(song.id) ?? null);
  const dpr = useDevicePixelRatio();
  // A fresh object here would change WaveformCanvas's effect deps on every
  // render and redraw the silhouette on every library tick.
  const viewport = useMemo(() => fitTheSongViewport(song.durationSec), [song.durationSec]);

  useEffect(() => {
    if (!inView || peaks) return;
    let cancelled = false;
    Promise.all(ROLES.map(role => loadSongPeaks(song, role)))
      .then(loaded => {
        const byRole = {} as Record<(typeof ROLES)[number], Int8Array>;
        ROLES.forEach((role, i) => { byRole[role] = loaded[i]; });
        const mixed = mixPeaks(byRole);
        cache.set(song.id, mixed);
        if (!cancelled) setPeaks(mixed);
      })
      // A row that can't draw its silhouette is not worth an error surface:
      // the row itself still plays, renames and deletes.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [inView, peaks, song]);

  return (
    <div className="song-row-thumb" ref={ref} style={{ width: THUMBNAIL_WIDTH_PX, height: THUMBNAIL_HEIGHT_PX }}>
      {peaks && (
        <WaveformCanvas
          peaks={peaks}
          color={WAVE_NEUTRAL}
          viewport={viewport}
          sampleRate={song.sampleRate}
          widthPx={THUMBNAIL_WIDTH_PX}
          heightPx={THUMBNAIL_HEIGHT_PX}
          dpr={dpr}
          label={`${song.title} waveform`}
        />
      )}
    </div>
  );
}
