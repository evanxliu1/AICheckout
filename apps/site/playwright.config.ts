import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 60000,
  retries: 0,
  use: { headless: true, trace: 'off', screenshot: 'only-on-failure' },
});
