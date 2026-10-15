import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/vitest.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['msw', 'msw/http', 'msw/node', 'vitest'],
});
