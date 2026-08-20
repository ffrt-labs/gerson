// The offline chip. It appears on every screen because it is the identity
// of the product, not a footnote: nothing Gerson holds ever leaves the
// machine, and the one exception (the separation model download) says so
// in its own consent modal.
export function OfflineChip() {
  return (
    <span className="offline-chip">
      <span className="icon" aria-hidden="true">cloud_off</span>
      On this device
    </span>
  );
}
