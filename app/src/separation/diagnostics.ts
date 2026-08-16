/**
 * TEMPORARY diagnostic instrumentation for issue #66 — "What restarts the
 * engine under a running Separation?".  Not part of the app; delete with the
 * branch.
 *
 * The whole point is to survive the event under investigation: a page reload,
 * a Memory Saver discard, or a renderer OOM-kill all wipe the console, so
 * every record is written *synchronously* to localStorage as it happens.
 * Whatever the tab does next, the trail up to that moment is on disk.
 */

const KEY = 'gerson:diag';
const MAX_RECORDS = 5000;

export interface DiagRecord {
  t: number;
  iso: string;
  event: string;
  detail?: unknown;
}

export function diag(event: string, detail?: unknown): void {
  const now = Date.now();
  const record: DiagRecord = { t: now, iso: new Date(now).toISOString(), event, detail };
  console.log('[DIAG]', record.iso, event, detail ?? '');
  try {
    const records = readDiag();
    records.push(record);
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    // localStorage full or unavailable — the console line above still stands.
  }
}

export function readDiag(): DiagRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as DiagRecord[];
  } catch {
    return [];
  }
}

/**
 * Records how *this* page load came to be, which is the crux of the ticket:
 * a Memory Saver discard, a crash restore, an HMR reload, and a user reload
 * are all "the page loaded again", and only these signals tell them apart.
 */
export function recordBoot(): void {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  diag('boot', {
    // True only on the load that follows a tab discard (Memory Saver).
    wasDiscarded: (document as Document & { wasDiscarded?: boolean }).wasDiscarded ?? null,
    // 'reload' for a reload of any origin (user, HMR, crash restore);
    // 'navigate' for a fresh navigation; 'back_forward' for a restore.
    navigationType: nav?.type ?? null,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
  });
}

/**
 * Page lifecycle: freeze/resume are the Energy Saver path (hypothesis 2),
 * pagehide/visibilitychange bracket a discard, and beforeunload fires for a
 * deliberate reload but not for a crash — so the *absence* of one of these
 * before a boot record is itself evidence.
 */
export function watchLifecycle(): void {
  for (const type of ['freeze', 'resume', 'pagehide', 'pageshow', 'beforeunload', 'unload'] as const) {
    addEventListener(type, () => { diag(`lifecycle:${type}`, { visibility: document.visibilityState }); });
  }
  document.addEventListener('visibilitychange', () => {
    diag('lifecycle:visibilitychange', { visibility: document.visibilityState });
  });

  // Vite's dev server reloads the page on a full-reload HMR event. If that is
  // what killed the run, this fires immediately before the boot record.
  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeFullReload', () => { diag('vite:beforeFullReload'); });
    import.meta.hot.on('vite:beforeUpdate', (p: unknown) => { diag('vite:beforeUpdate', p); });
    import.meta.hot.on('vite:ws:disconnect', () => { diag('vite:ws:disconnect'); });
  }

  // A service worker taking control would reload clients. Config says it
  // cannot (registerType 'prompt', no clientsClaim) — log it to be sure.
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    diag('sw:controllerchange', { controller: navigator.serviceWorker.controller?.scriptURL ?? null });
  });

  addEventListener('error', (e) => { diag('window:error', { message: e.message, filename: e.filename, lineno: e.lineno }); });
  addEventListener('unhandledrejection', (e) => { diag('window:unhandledrejection', { reason: String(e.reason) }); });
}
