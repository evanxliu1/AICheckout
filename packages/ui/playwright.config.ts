import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 60000,
  retries: 0,
  use: { headless: true, baseURL: 'http://127.0.0.1:5178', trace: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npx vite build && npx vite preview --host 127.0.0.1',
    url: 'http://127.0.0.1:5178',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
