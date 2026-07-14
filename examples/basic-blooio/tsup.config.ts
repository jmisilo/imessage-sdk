import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    webhook: 'src/webhook.ts',
  },
  format: ['esm'],
  target: 'es2022',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
});
