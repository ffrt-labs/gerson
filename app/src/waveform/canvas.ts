/**
 * The narrow slice of CanvasRenderingContext2D the waveform and overlay
 * renderers actually call — structurally compatible with the real thing, so
 * tests can supply a recording fake without a DOM (this repo's vitest
 * environment is 'node', no canvas/jsdom available).
 */
export interface Canvas2DLike {
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  // Widened to match the real CanvasRenderingContext2D's own property type
  // (string | CanvasGradient | CanvasPattern) — production code only ever
  // assigns a string, but the field must accept whatever the real DOM type
  // allows for a live context to satisfy this interface structurally.
  fillStyle: string | CanvasGradient | CanvasPattern;
}
