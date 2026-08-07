// TypeScript's lib.dom.d.ts types FileSystemFileHandle/FileSystemWritableFileStream
// (used already for OPFS access handles) but not the picker entry points —
// showSaveFilePicker is Chromium-only and not part of any W3C standard the
// DOM lib tracks. Minimal ambient declaration for what the delivery ladder
// (§6.1) needs.
export {};

declare global {
  interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string | string[]>;
  }

  interface SaveFilePickerOptions {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
  }

  interface Window {
    showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  }
}
