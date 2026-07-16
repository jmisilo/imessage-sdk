/* global process, URL */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const environmentPath = fileURLToPath(new URL('../../../.env.cli-test', import.meta.url));

try {
  process.loadEnvFile(environmentPath);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(pnpm, ['exec', 'vitest', 'run', 'test/cli.integration.test.ts'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: process.env,
  stdio: 'inherit',
});

child.once('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
