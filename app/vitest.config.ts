import { configDefaults, defineConfig } from 'vitest/config';

// Test files that call encodePcm/decodeFlac/createEncoder for real, rather
// than mocking codec/flac.ts out — the only ones that need test/setup.ts's
// Node fetch shim for libflacjs's real-wasm build (#84).
const REAL_CODEC_TEST_FILES = [
  'src/codec/__tests__/flac.test.ts',
  'src/import/__tests__/decodeCandidate.test.ts',
  'src/import/__tests__/importSet.test.ts',
  'src/export/__tests__/exportMix.test.ts',
  'src/export/__tests__/exportStems.test.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'codec',
          // See test/setup.ts — the fetch shim it installs is needed only by
          // tests that exercise libflacjs's real-wasm build under Node
          // (i.e. call encodePcm/decodeFlac/createEncoder for real, rather
          // than mocking codec/flac.ts out), so it's scoped to exactly those
          // files rather than applied to every test file (#84).
          include: REAL_CODEC_TEST_FILES,
          setupFiles: ['./test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'default',
          exclude: [...configDefaults.exclude, ...REAL_CODEC_TEST_FILES],
        },
      },
    ],
  },
});
