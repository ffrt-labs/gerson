import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';
import { start } from './separation/engine.ts';
import { recordBoot, watchLifecycle, readDiag } from './separation/diagnostics.ts';

// TEMPORARY (#66): first thing on the page, before anything can reload it.
recordBoot();
watchLifecycle();
(window as Window & { diag?: unknown }).diag = readDiag;

// Start the separation engine before rendering so that workers are ready
// to pick up queued jobs as soon as the UI subscribes to events.
start().catch(console.error);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
