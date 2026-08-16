import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // jsdom (opted into per-file via a `// @vitest-environment jsdom` pragma) needs a real
    // http(s) origin for window.localStorage/sessionStorage to be enabled at all — without one it
    // silently leaves both undefined instead of throwing, which is confusing to debug.
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    // Node 22+'s own experimental global `localStorage`/`sessionStorage` otherwise shadows the
    // ones jsdom/happy-dom install on `window` (silently leaving both undefined in a DOM test) —
    // see the `test`/`test:watch` npm scripts, which set NODE_OPTIONS=--no-experimental-webstorage
    // before vitest starts (must happen at the Node process level, not here).
  },
});
