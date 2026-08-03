import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Library } from './routes/Library';
import { Player } from './routes/Player';

const router = createBrowserRouter([
  { path: '/', element: <Library /> },
  { path: '/player', element: <Player /> },
  { path: '/player/:id', element: <Player /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
