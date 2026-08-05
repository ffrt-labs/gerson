import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Library } from './routes/Library';
import { Player } from './routes/Player';

const routes = [
  { path: '/', element: <Library /> },
  { path: '/player', element: <Player /> },
  { path: '/player/:id', element: <Player /> },
];

// Dev-only route exercising the four-stretcher transport wrapper in
// isolation (issue #23) — not part of the shipped product surface. A
// dynamic import behind a statically-false import.meta.env.DEV check, not a
// static one: a static import of PlaybackHarness (and transitively
// signalsmith-stretch) survives into the production bundle even when its
// JSX is provably unreachable — verified by building and grepping dist/ for
// "PlaybackHarness"/"signalsmith" (present with a static import, absent
// with this one).
if (import.meta.env.DEV) {
  const { PlaybackHarness } = await import('./dev/PlaybackHarness');
  routes.push({ path: '/dev/playback', element: <PlaybackHarness /> });
}

const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
