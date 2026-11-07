import { defineConfig } from '@playwright/test';
import shared from './playwright.shared.config';
export default defineConfig({ ...shared, testDir: './tests-remix', outputDir: 'test-results-remix',
  use: { ...shared.use, launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } } });
