export async function hashBytes(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  // Narrow to Uint8Array<ArrayBuffer> — our callers never pass SharedArrayBuffers.
  const data =
    bytes instanceof Uint8Array
      ? (bytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(bytes as ArrayBuffer);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
