import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // First injection loads Fastify's test transport under Vite. Allow cold module
    // startup on shared CI hosts; the harness tests enforce their own deadlines.
    testTimeout: 15000,
    maxWorkers: 2,
  },
});
