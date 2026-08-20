import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Never skipWaiting/clientsClaim: a waiting worker only takes over once
      // the user explicitly reloads via UpdateBanner. Silently activating
      // would reload the page out from under a running Separation, killing
      // its Worker (spec §8).
      registerType: 'prompt',
      // Registered manually via the `virtual:pwa-register/react` hook in
      // UpdateBanner, so the plugin shouldn't also inject its own script.
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'Gerson',
        short_name: 'Gerson',
        description:
          'Practise along to recorded music, fully offline: split a song into stems, then isolate, slow down, and loop them.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#080a0e',
        theme_color: '#080a0e',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // An explicit allowlist rather than the default glob, so a stray
        // large file landing under public/ (dev fixtures, the model weights
        // once #35 lands) can't silently balloon the precache — it has to be
        // added here on purpose. woff2 is on the list because the design's
        // two families are self-hosted (see src/fonts.css): a webfont that
        // only arrives online would break the offline promise on every
        // screen that renders a number.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,webmanifest,woff2}'],
        // dev-stems/** are local-only fixtures for the dev-only playback
        // harness (never referenced in a production build); model/** is
        // where #35 serves the pinned weights from — kept out of the
        // precache manifest on purpose (spec §8: an 80 MB artifact in there
        // is one careless change away from re-downloading on every deploy).
        // It also lives in OPFS, not Cache Storage, once fetched.
        globIgnores: ['**/dev-stems/**', '**/model/**'],
      },
    }),
  ],
  worker: {
    // Bundle worker files as ES modules so they can use import() and import.meta.url.
    format: 'es',
  },
});
