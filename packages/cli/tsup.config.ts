import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'es2022',
  platform: 'node',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ['@napi-rs/keyring'],
});
