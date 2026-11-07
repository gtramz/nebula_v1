import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests-performance', workers: 1, timeout: 120_000,
  outputDir: process.env.NEBULA_PERF_OUTPUT ?? 'test-results-performance',
  use: { baseURL: 'http://127.0.0.1:4175', trace: 'on' },
  webServer: { command: 'node scripts/test-server.mjs', url: 'http://127.0.0.1:4175', reuseExistingServer: false },
  projects: [
    { name: 'chrome-desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'chrome-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', channel: 'chrome' } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
