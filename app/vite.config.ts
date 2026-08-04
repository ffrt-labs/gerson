import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    // Bundle worker files as ES modules so they can use import() and import.meta.url.
    format: 'es',
  },
})
