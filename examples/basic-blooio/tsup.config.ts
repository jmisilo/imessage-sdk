import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'examples/basic-blooio/src/index.ts',
    webhook: 'examples/basic-blooio/src/webhook.ts',
  },
  format: ['esm'],
  outDir: 'examples/basic-blooio/dist',
  target: 'es2022',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
});
