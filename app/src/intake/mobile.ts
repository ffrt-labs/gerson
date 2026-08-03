// Mobile UAs are refused up front for separation (§9).
// Peak RSS ~2.3 GB per worker vs ~1.5 GB iPhone WebContent limit makes failure
// predictable. This over-refuses capable tablets — that is the accepted trade-off.
export function isMobileUA(ua: string = navigator.userAgent): boolean {
  return /iPhone|iPad|iPod|Android/i.test(ua);
}
