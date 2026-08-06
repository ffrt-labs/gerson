// Sizes a canvas's backing store to devicePixelRatio and hands back its 2D
// context — the one bit of imperative setup every canvas in the stack
// shares. Deliberately not a hook: each row/overlay keeps its own useEffect
// deps array, so which prop change triggers a redraw stays explicit at the
// call site rather than hidden behind a shared effect.
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
): CanvasRenderingContext2D | null {
  if (widthPx <= 0 || heightPx <= 0) return null;
  canvas.width = widthPx;
  canvas.height = heightPx;
  return canvas.getContext('2d');
}
