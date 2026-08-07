import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Icons for the installable PWA (issue #34), generated once from the
// existing favicon.svg mark and committed to public/ — not regenerated at
// build time, since the source mark changes rarely.
export default defineConfig({
  headLinkOptions: {
    preset: '2023',
  },
  preset: minimal2023Preset,
  images: ['public/favicon.svg'],
});
