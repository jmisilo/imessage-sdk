import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import type { CliContext, PromptService } from '../src/context.js';
import type { CredentialRef, CredentialStore } from '../src/credentials.js';
import { ConfigStore } from '../src/config.js';
import { CredentialStoreError, MemoryCredentialStore } from '../src/credentials.js';
import { runCli } from '../src/program.js';

class Capture extends Writable {
  readonly chunks: Buffer[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

const prompt: PromptService = {
  async text() {
    throw new Error('Unexpected prompt');
  },
  async secret() {
    throw new Error('Unexpected prompt');
  },
  async confirm() {
    throw new Error('Unexpected prompt');
  },
};

function context(
  configPath: string,
  options: { readonly input?: string; readonly credentials?: CredentialStore } = {},
): { readonly context: CliContext; readonly stdout: Capture; readonly stderr: Capture } {
  const stdout = new Capture();
  const stderr = new Capture();
  return {
    context: {
      env: {},
      stdin: Readable.from(options.input === undefined ? [] : [options.input]),
      stdout,
      stderr,
      colorDepth: 1,
      configStore: new ConfigStore(configPath),
      credentialStore: options.credentials ?? new MemoryCredentialStore('test-imessage-cli'),
      prompt,
      cwd: process.cwd(),
    },
    stdout,
    stderr,
  };
}

class OneShotFailingCredentialStore implements CredentialStore {
  failNextDelete = false;

  constructor(readonly delegate: MemoryCredentialStore) {}

  async get(ref: CredentialRef): Promise<string | null> {
    return await this.delegate.get(ref);
  }

  async set(ref: CredentialRef, secret: string): Promise<void> {
    await this.delegate.set(ref, secret);
  }

  async delete(ref: CredentialRef): Promise<boolean> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new CredentialStoreError('Simulated credential deletion failure.');
    }
    return await this.delegate.delete(ref);
  }
}

function jsonLine(output: Capture): Record<string, unknown> {
  return JSON.parse(output.text()) as Record<string, unknown>;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => rm(path, { recursive: true })),
  );
});

async function temporaryConfig(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'imessage-cli-test-'));
  temporaryDirectories.push(directory);
  return { directory, path: join(directory, 'config.json') };
}

describe('imessage-cli', () => {
  it('requires an explicit opt-in for the experimental webhook server', async () => {
    const config = await temporaryConfig();
    const test = context(config.path);

    const code = await runCli(
      ['webhook', 'serve', '--provider', 'blooio', '--json', '--no-input'],
      test.context,
    );

    expect(code).toBe(2);
    expect(jsonLine(test.stderr)).toMatchObject({
      ok: false,
      command: 'webhook.serve',
      error: {
        type: 'CliUsageError',
        message: 'The CLI webhook server is experimental. Re-run this command with --experimental.',
      },
    });
    expect(test.stdout.text()).toBe('');
  });

  it('lists every bundled provider as stable JSON', async () => {
    const config = await temporaryConfig();
    const test = context(config.path);

    const code = await runCli(['provider', 'list', '--json'], test.context);

    expect(code).toBe(0);
    expect(jsonLine(test.stdout)).toMatchObject({
      schemaVersion: 1,
      ok: true,
      command: 'provider.list',
      data: [{ name: 'blooio' }, { name: 'photon' }, { name: 'sendblue' }],
    });
    expect(test.stderr.text()).toBe('');
  });

  it('stores connection secrets and identities outside the JSON config', async () => {
    const config = await temporaryConfig();
    const credentials = new MemoryCredentialStore('test-imessage-cli');
    const add = context(config.path, { credentials });

    const addCode = await runCli(
      [
        'connection',
        'add',
        'support',
        '--provider',
        'blooio',
        '--api-key',
        'private-api-key',
        '--from-number',
        '+15555550100',
        '--webhook-secret',
        'private-webhook-secret',
        '--no-input',
        '--json',
      ],
      add.context,
    );

    expect(addCode).toBe(0);
    const storedConfig = await readFile(config.path, 'utf8');
    expect(storedConfig).not.toContain('private-api-key');
    expect(storedConfig).not.toContain('private-webhook-secret');
    expect(storedConfig).not.toContain('+15555550100');
    expect(storedConfig).toContain('support');

    const show = context(config.path, { credentials });
    const showCode = await runCli(['connection', 'show', 'support', '--json'], show.context);
    expect(showCode).toBe(0);
    expect(jsonLine(show.stdout)).toMatchObject({
      ok: true,
      data: {
        name: 'support',
        provider: 'blooio',
        default: true,
        fields: {
          apiKey: { configured: true },
          sender: { configured: true },
          webhookSecret: { configured: true },
        },
      },
    });

    const send = context(config.path, { credentials });
    const sendCode = await runCli(
      [
        'send',
        '--provider',
        'blooio',
        '--to',
        '+15555550101',
        '--text',
        'Hello',
        '--dry-run',
        '--json',
      ],
      send.context,
    );
    expect(sendCode).toBe(0);
    expect(jsonLine(send.stdout)).toMatchObject({
      ok: true,
      context: { provider: 'blooio', connectionId: 'support' },
      data: { dryRun: true },
    });

    const remove = context(config.path, { credentials });
    const removeCode = await runCli(
      ['connection', 'remove', 'support', '--yes', '--json'],
      remove.context,
    );
    expect(removeCode).toBe(0);
    expect((await new ConfigStore(config.path).load()).connections).toEqual({});
  });

  it('accepts the agent stdin envelope with a local Photon attachment', async () => {
    const config = await temporaryConfig();
    const attachmentPath = join(config.directory, 'screenshot.png');
    await writeFile(attachmentPath, Buffer.from([1, 2, 3, 4]));
    const input = JSON.stringify({
      to: [{ kind: 'phone', value: '+15555550101' }],
      text: 'Generated by an agent',
      attachments: [{ kind: 'image', source: { type: 'path', path: attachmentPath } }],
      idempotencyKey: 'agent-run-018fd6',
    });
    const test = context(config.path, { input });

    const code = await runCli(
      [
        'send',
        '--provider',
        'photon',
        '--project-id',
        'project',
        '--project-secret',
        'secret',
        '--input',
        '-',
        '--dry-run',
        '--json',
      ],
      test.context,
    );

    expect(code).toBe(0);
    expect(jsonLine(test.stdout)).toMatchObject({
      ok: true,
      data: {
        input: {
          text: 'Generated by an agent',
          attachments: [{ source: { type: 'bytes', data: { byteLength: 4 } } }],
          idempotencyKey: 'agent-run-018fd6',
        },
      },
    });
  });

  it('normalizes explicit phone addresses during a Sendblue dry run', async () => {
    const config = await temporaryConfig();
    const test = context(config.path);

    const code = await runCli(
      [
        'send',
        '--provider',
        'sendblue',
        '--api-key',
        'key',
        '--api-secret',
        'secret',
        '--from-number',
        '+15555550100',
        '--to',
        'phone:+15555550101',
        '--text',
        'Hello',
        '--dry-run',
        '--json',
      ],
      test.context,
    );

    expect(code).toBe(0);
    expect(jsonLine(test.stdout)).toMatchObject({
      data: { input: { to: [{ kind: 'phone', value: '+15555550101' }] } },
    });
  });

  it('rejects local Blooio attachments before trying to read them', async () => {
    const config = await temporaryConfig();
    const test = context(config.path);

    const code = await runCli(
      [
        'send',
        '--provider',
        'blooio',
        '--api-key',
        'key',
        '--to',
        '+15555550101',
        '--image',
        './does-not-exist.png',
        '--dry-run',
        '--json',
      ],
      test.context,
    );

    expect(code).toBe(2);
    expect(jsonLine(test.stderr)).toMatchObject({
      error: {
        code: 'invalid_cli_input',
        message: expect.stringContaining('requires attachment URLs'),
      },
    });
  });

  it('publishes runtime destination and content requirements in the send schema', async () => {
    const config = await temporaryConfig();
    const test = context(config.path);

    expect(await runCli(['schema', 'send', '--json'], test.context)).toBe(0);
    expect(jsonLine(test.stdout)).toMatchObject({
      data: { allOf: [{ oneOf: expect.any(Array) }, { anyOf: expect.any(Array) }] },
    });
  });

  it('replaces a default connection across providers without leaving an invalid default', async () => {
    const config = await temporaryConfig();
    const credentials = new MemoryCredentialStore('test-imessage-cli');
    const add = context(config.path, { credentials });
    expect(
      await runCli(
        [
          'connection',
          'add',
          'support',
          '--provider',
          'blooio',
          '--api-key',
          'old-key',
          '--no-input',
        ],
        add.context,
      ),
    ).toBe(0);

    const replace = context(config.path, { credentials });
    expect(
      await runCli(
        [
          'connection',
          'add',
          'support',
          '--provider',
          'photon',
          '--project-id',
          'project',
          '--project-secret',
          'secret',
          '--force',
          '--no-input',
        ],
        replace.context,
      ),
    ).toBe(0);

    await expect(new ConfigStore(config.path).load()).resolves.toMatchObject({
      connections: { support: { provider: 'photon' } },
      defaultConnections: { photon: 'support' },
    });
    expect((await new ConfigStore(config.path).load()).defaultConnections.blooio).toBeUndefined();
    await expect(
      credentials.get({ connection: 'support', provider: 'blooio', name: 'apiKey' }),
    ).resolves.toBeNull();
    await expect(
      credentials.get({ connection: 'support', provider: 'photon', name: 'projectSecret' }),
    ).resolves.toBe('secret');
  });

  it('rolls back config and credentials when cross-provider replacement fails', async () => {
    const config = await temporaryConfig();
    const memory = new MemoryCredentialStore('test-imessage-cli');
    const credentials = new OneShotFailingCredentialStore(memory);
    const add = context(config.path, { credentials });
    expect(
      await runCli(
        [
          'connection',
          'add',
          'support',
          '--provider',
          'blooio',
          '--api-key',
          'old-key',
          '--no-input',
        ],
        add.context,
      ),
    ).toBe(0);

    credentials.failNextDelete = true;
    const replace = context(config.path, { credentials });
    expect(
      await runCli(
        [
          'connection',
          'add',
          'support',
          '--provider',
          'photon',
          '--project-id',
          'project',
          '--project-secret',
          'secret',
          '--force',
          '--no-input',
          '--json',
        ],
        replace.context,
      ),
    ).toBe(2);

    await expect(new ConfigStore(config.path).load()).resolves.toMatchObject({
      connections: { support: { provider: 'blooio' } },
      defaultConnections: { blooio: 'support' },
    });
    await expect(
      memory.get({ connection: 'support', provider: 'blooio', name: 'apiKey' }),
    ).resolves.toBe('old-key');
    await expect(
      memory.get({ connection: 'support', provider: 'photon', name: 'projectSecret' }),
    ).resolves.toBeNull();
  });

  it('keeps a connection removable after credential cleanup fails', async () => {
    const config = await temporaryConfig();
    const memory = new MemoryCredentialStore('test-imessage-cli');
    const credentials = new OneShotFailingCredentialStore(memory);
    const add = context(config.path, { credentials });
    expect(
      await runCli(
        [
          'connection',
          'add',
          'support',
          '--provider',
          'blooio',
          '--api-key',
          'old-key',
          '--no-input',
        ],
        add.context,
      ),
    ).toBe(0);

    credentials.failNextDelete = true;
    const remove = context(config.path, { credentials });
    expect(
      await runCli(['connection', 'remove', 'support', '--yes', '--json'], remove.context),
    ).toBe(2);

    await expect(new ConfigStore(config.path).load()).resolves.toMatchObject({
      connections: { support: { provider: 'blooio' } },
    });
    await expect(
      memory.get({ connection: 'support', provider: 'blooio', name: 'apiKey' }),
    ).resolves.toBe('old-key');
  });

  it('returns structured errors without prompting in JSON mode', async () => {
    const config = await temporaryConfig();
    const test = context(config.path);

    const code = await runCli(
      ['send', '--provider', 'photon', '--to', '+15555550101', '--text', 'Hello', '--json'],
      test.context,
    );

    expect(code).toBe(2);
    expect(test.stdout.text()).toBe('');
    expect(jsonLine(test.stderr)).toMatchObject({
      ok: false,
      command: 'send',
      error: { code: 'invalid_config', retryable: false, safeToRetry: false },
    });
  });

  it('returns command-syntax failures as structured JSON on stderr', async () => {
    const config = await temporaryConfig();
    const test = context(config.path);

    const code = await runCli(['message', 'get', '--json'], test.context);

    expect(code).toBe(2);
    expect(test.stdout.text()).toBe('');
    expect(jsonLine(test.stderr)).toMatchObject({
      schemaVersion: 1,
      ok: false,
      command: 'cli',
      error: { code: 'invalid_cli_input' },
    });
  });
});
