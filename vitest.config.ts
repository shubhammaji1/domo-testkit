import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'examples/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/vitest.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
        'src/security.ts': { statements: 95, branches: 90 },
        'src/index.ts': { statements: 95, branches: 90 },
      },
    },
  },
});
