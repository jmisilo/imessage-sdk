import { spawn } from 'node:child_process';
import { log, error as logError } from 'node:console';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const prerelease = await readPrereleaseState();
const tag = prerelease?.mode === 'pre' ? prerelease.tag : undefined;
const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = ['exec', 'changeset', 'publish'];

log(
  tag === undefined
    ? 'Publishing stable packages with the default npm dist-tag.'
    : `Publishing prerelease packages with the ${tag} npm dist-tag.`,
);

if (process.argv.includes('--dry-run')) {
  log(`${executable} ${args.join(' ')}`);
} else {
  const child = spawn(executable, args, { stdio: 'inherit' });

  child.once('error', (error) => {
    logError(error);
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    if (signal !== null) {
      logError(`Changesets publish exited after receiving ${signal}.`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}

async function readPrereleaseState() {
  try {
    return JSON.parse(await readFile(new URL('../.changeset/pre.json', import.meta.url), 'utf8'));
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function isMissingFile(error) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
