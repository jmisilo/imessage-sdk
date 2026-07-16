import { execFile as executeFile } from 'node:child_process';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

const execFile = promisify(executeFile);
const rootDirectory = new URL('../../../', import.meta.url);
const binaryPath = new URL('../dist/cli.js', import.meta.url);
const enabled = process.env['IMESSAGE_CLI_RUN_LIVE'] === '1';
const runId = `cli-live-${Date.now()}`;

interface CommandResult {
  readonly schemaVersion: 1;
  readonly ok: true;
  readonly command: string;
  readonly context?: { readonly provider?: string; readonly connectionId?: string };
  readonly data: unknown;
}

interface SentMessage {
  readonly providerMessageId: string;
  readonly conversationId: string;
}

const secretValues = [
  process.env['BLOOIO_API_KEY'],
  process.env['BLOOIO_WEBHOOK_SECRET'],
  process.env['PHOTON_PROJECT_SECRET'],
  process.env['PHOTON_WEBHOOK_SECRET'],
  process.env['SENDBLUE_API_KEY'],
  process.env['SENDBLUE_API_SECRET'],
  process.env['SENDBLUE_WEBHOOK_SECRET'],
].filter((value): value is string => value !== undefined && value.length > 0);

describe.skipIf(!enabled)('imessage-cli live provider API', () => {
  beforeAll(() => {
    expect(process.env['IMESSAGE_CLI_RUN_LIVE']).toBe('1');
  });

  it('exercises Blooio through the built CLI', async () => {
    const recipient = required('IMESSAGE_CLI_TEST_RECIPIENT');
    const imageUrl = required('IMESSAGE_CLI_TEST_IMAGE_URL');
    const videoUrl = required('IMESSAGE_CLI_TEST_VIDEO_URL');
    const fileUrl = required('IMESSAGE_CLI_TEST_FILE_URL');

    await command(['provider', 'blooio', 'numbers', 'list', '--json', '--no-input']);
    const conversation = await openConversation('blooio', recipient);
    const text = await sendText('blooio', conversation, 'Blooio text');

    await command([
      'message',
      'get',
      '--provider',
      'blooio',
      '--conversation',
      text.conversationId,
      '--message',
      text.providerMessageId,
      '--json',
      '--no-input',
    ]);
    await command([
      'provider',
      'blooio',
      'message',
      'status',
      '--conversation',
      text.conversationId,
      '--message',
      text.providerMessageId,
      '--json',
      '--no-input',
    ]);
    await sendAttachments(
      'blooio',
      conversation,
      imageUrl,
      videoUrl,
      fileUrl,
      text.providerMessageId,
    );
    await testCommonInteractions('blooio', text);
  }, 180_000);

  it('exercises Photon through the built CLI', async () => {
    const recipient = required('IMESSAGE_CLI_TEST_RECIPIENT');
    const imageUrl = required('IMESSAGE_CLI_TEST_IMAGE_URL');
    const videoUrl = required('IMESSAGE_CLI_TEST_VIDEO_URL');
    const fileUrl = required('IMESSAGE_CLI_TEST_FILE_URL');

    await command(['provider', 'photon', 'line', 'show', '--json', '--no-input']);
    const conversation = await openConversation('photon', recipient);
    const text = await sendText('photon', conversation, 'Photon text');

    await command([
      'message',
      'get',
      '--provider',
      'photon',
      '--conversation',
      text.conversationId,
      '--message',
      text.providerMessageId,
      '--json',
      '--no-input',
    ]);
    await sendAttachments(
      'photon',
      conversation,
      imageUrl,
      videoUrl,
      fileUrl,
      text.providerMessageId,
    );
    await testCommonInteractions('photon', text);
  }, 180_000);

  it('exercises Sendblue through the built CLI', async () => {
    const recipient = required('IMESSAGE_CLI_TEST_RECIPIENT');
    const imageUrl = required('IMESSAGE_CLI_TEST_IMAGE_URL');
    const videoUrl = required('IMESSAGE_CLI_TEST_VIDEO_URL');
    const fileUrl = required('IMESSAGE_CLI_TEST_FILE_URL');

    const conversation = await openConversation('sendblue', recipient);
    const text = await sendText('sendblue', conversation, 'Sendblue text');

    await command([
      'message',
      'get',
      '--provider',
      'sendblue',
      '--conversation',
      text.conversationId,
      '--message',
      text.providerMessageId,
      '--json',
      '--no-input',
    ]);
    await command([
      'provider',
      'sendblue',
      'message',
      'status',
      '--conversation',
      text.conversationId,
      '--message',
      text.providerMessageId,
      '--json',
      '--no-input',
    ]);

    // Sendblue accepts one attachment per message and does not support replies.
    for (const [flag, url] of [
      ['--image', imageUrl],
      ['--video', videoUrl],
      ['--file', fileUrl],
    ] as const) {
      await command([
        'send',
        '--provider',
        'sendblue',
        '--conversation',
        conversation,
        '--text',
        `${runId} Sendblue ${flag.slice(2)} attachment`,
        flag,
        url,
        '--json',
        '--no-input',
      ]);
    }
    await command([
      'typing',
      'start',
      '--provider',
      'sendblue',
      conversation,
      '--json',
      '--no-input',
    ]);
    await command([
      'typing',
      'stop',
      '--provider',
      'sendblue',
      conversation,
      '--json',
      '--no-input',
    ]);
  }, 180_000);
});

async function openConversation(provider: 'blooio' | 'photon' | 'sendblue', recipient: string) {
  const result = await command([
    'conversation',
    'open',
    '--provider',
    provider,
    '--participant',
    recipient,
    '--json',
    '--no-input',
  ]);
  return field(result.data, 'id');
}

async function sendText(
  provider: 'blooio' | 'photon' | 'sendblue',
  conversation: string,
  label: string,
): Promise<SentMessage> {
  const result = await command([
    'send',
    '--provider',
    provider,
    '--conversation',
    conversation,
    '--text',
    `${runId} ${label}`,
    ...(provider === 'sendblue' ? [] : ['--idempotency-key', `${runId}-${provider}-text`]),
    '--json',
    '--no-input',
  ]);
  return {
    providerMessageId: field(result.data, 'providerMessageId'),
    conversationId: field(result.data, 'conversationId'),
  };
}

async function sendAttachments(
  provider: 'blooio' | 'photon',
  conversation: string,
  imageUrl: string,
  videoUrl: string,
  fileUrl: string,
  replyTo: string,
): Promise<void> {
  await command([
    'send',
    '--provider',
    provider,
    '--conversation',
    conversation,
    '--text',
    `${runId} ${provider} attachments and reply`,
    '--image',
    imageUrl,
    '--video',
    videoUrl,
    '--file',
    fileUrl,
    '--reply-to',
    replyTo,
    '--idempotency-key',
    `${runId}-${provider}-attachments`,
    '--json',
    '--no-input',
  ]);
}

async function testCommonInteractions(
  provider: 'blooio' | 'photon',
  message: SentMessage,
): Promise<void> {
  await command([
    'conversation',
    'get',
    '--provider',
    provider,
    message.conversationId,
    '--json',
    '--no-input',
  ]);
  await command([
    'typing',
    'start',
    '--provider',
    provider,
    message.conversationId,
    '--json',
    '--no-input',
  ]);
  await command([
    'typing',
    'stop',
    '--provider',
    provider,
    message.conversationId,
    '--json',
    '--no-input',
  ]);
  await command([
    'reaction',
    'add',
    '--provider',
    provider,
    '--conversation',
    message.conversationId,
    '--message',
    message.providerMessageId,
    '--reaction',
    'like',
    '--json',
    '--no-input',
  ]);
  await command([
    'reaction',
    'remove',
    '--provider',
    provider,
    '--conversation',
    message.conversationId,
    '--message',
    message.providerMessageId,
    '--reaction',
    'like',
    '--json',
    '--no-input',
  ]);
  await command([
    'conversation',
    'mark-read',
    '--provider',
    provider,
    message.conversationId,
    '--json',
    '--no-input',
  ]);
}

async function command(arguments_: readonly string[]): Promise<CommandResult> {
  try {
    const { stdout } = await execFile(process.execPath, [binaryPath.pathname, ...arguments_], {
      cwd: rootDirectory.pathname,
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as unknown;
    if (!isSuccess(parsed)) {
      throw new Error(`CLI returned an invalid JSON success response: ${JSON.stringify(parsed)}`);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redact(message), { cause: error });
  }
}

function isSuccess(value: unknown): value is CommandResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly ok?: unknown }).ok === true &&
    (value as { readonly schemaVersion?: unknown }).schemaVersion === 1
  );
}

function field(value: unknown, name: string): string {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`CLI response did not include ${name}.`);
  }
  const candidate = (value as Record<string, unknown>)[name];
  if (typeof candidate !== 'string') throw new Error(`CLI response did not include ${name}.`);
  return candidate;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required when IMESSAGE_CLI_RUN_LIVE=1.`);
  }
  return value;
}

function redact(value: string): string {
  return secretValues.reduce((result, secret) => result.split(secret).join('[REDACTED]'), value);
}
