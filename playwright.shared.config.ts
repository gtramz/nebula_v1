import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-shared', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4175', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/test-server.mjs', url: 'http://127.0.0.1:4175', reuseExistingServer: false },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
});
