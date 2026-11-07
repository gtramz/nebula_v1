import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['lib/**/*.test.ts', 'artifacts/nebula/src/features/remix/*.test.ts'] } });
