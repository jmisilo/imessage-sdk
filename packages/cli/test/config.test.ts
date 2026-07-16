import { access, chmod, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CliConfigSchema,
  ConfigError,
  ConfigStore,
  createEmptyConfig,
  getDefaultConfigPath,
} from '../src/config.js';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'imessage-cli-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('CLI configuration', () => {
  it('resolves XDG, Windows, and home-directory configuration paths', () => {
    expect(
      getDefaultConfigPath({
        env: { XDG_CONFIG_HOME: '/tmp/xdg' },
        homeDirectory: '/home/user',
        platform: 'linux',
      }),
    ).toBe(join('/tmp/xdg', 'imessage-cli', 'config.json'));

    expect(
      getDefaultConfigPath({
        env: { APPDATA: 'C:\\Users\\user\\AppData\\Roaming' },
        homeDirectory: 'C:\\Users\\user',
        platform: 'win32',
      }),
    ).toBe(join('C:\\Users\\user\\AppData\\Roaming', 'imessage-cli', 'config.json'));

    expect(getDefaultConfigPath({ env: {}, homeDirectory: '/home/user', platform: 'linux' })).toBe(
      join('/home/user', '.config', 'imessage-cli', 'config.json'),
    );
  });

  it('returns an empty v1 configuration when the file does not exist', async () => {
    const directory = await createTemporaryDirectory();
    const store = new ConfigStore(join(directory, 'missing', 'config.json'));

    await expect(store.load()).resolves.toEqual(createEmptyConfig());
  });

  it('atomically saves and loads named connections', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'nested', 'config.json');
    const store = new ConfigStore(path);
    const config = {
      version: 1,
      connections: {
        personal: {
          provider: 'blooio',
          settings: { fromNumber: '+15551234567', markReadEnabled: true, timeoutMs: 2_000 },
        },
      },
      defaultConnections: { blooio: 'personal' },
    } as const;

    await store.save(config);

    await expect(store.load()).resolves.toEqual(config);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(config);
    expect(
      (await readdir(join(directory, 'nested'))).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);

    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(directory, 'nested'))).mode & 0o777).toBe(0o700);
    }
  });

  it('does not change permissions on an existing parent directory', async () => {
    const directory = await createTemporaryDirectory();
    if (process.platform === 'win32') return;
    await chmod(directory, 0o750);

    await new ConfigStore(join(directory, 'config.json')).save(createEmptyConfig());

    expect((await stat(directory)).mode & 0o777).toBe(0o750);
  });

  it('creates a configuration exclusively without replacing an existing file', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'config.json');
    const store = new ConfigStore(path);
    const original = {
      version: 1,
      connections: { main: { provider: 'photon' } },
      defaultConnections: { photon: 'main' },
    } as const;
    await store.create(original);

    await expect(store.create(createEmptyConfig())).rejects.toBeInstanceOf(ConfigError);
    await expect(store.load()).resolves.toEqual(original);
  });

  it('rejects unknown providers and inconsistent defaults', () => {
    expect(
      CliConfigSchema.safeParse({
        version: 1,
        connections: { main: { provider: 'unknown' } },
        defaultConnections: {},
      }).success,
    ).toBe(false);

    expect(
      CliConfigSchema.safeParse({
        version: 1,
        connections: { main: { provider: 'photon' } },
        defaultConnections: { blooio: 'main' },
      }).success,
    ).toBe(false);
  });

  it('rejects malformed JSON without replacing it', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'config.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, '{not json', { mode: 0o600 });
    const store = new ConfigStore(path);

    await expect(store.load()).rejects.toBeInstanceOf(ConfigError);
    await expect(access(path)).resolves.toBeUndefined();
    await expect(readFile(path, 'utf8')).resolves.toBe('{not json');
  });
});
