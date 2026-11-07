import { defineConfig } from '@playwright/test';
import profiles from './playwright.performance.config';
export default defineConfig({ ...profiles, testDir: './tests-shared', testMatch: 'return-context.spec.ts',
  outputDir: 'test-results-return', timeout: 30_000 });
