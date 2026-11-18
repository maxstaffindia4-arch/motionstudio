import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // lint/QA stages spawn processes and a shared Chromium — allow headroom
    // on slower CI runners.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
