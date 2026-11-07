import { defineConfig } from '@playwright/test';
import shared from './playwright.shared.config';
export default defineConfig({ ...shared, testDir: './tests-collaborations', outputDir: 'test-results-collaborations' });
