import process from 'node:process';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { MessageLocator } from 'imessage-sdk';
import { createIMessageClient, IMessageSDKError } from 'imessage-sdk';

import type { SendblueMessageStatus } from '../src/index.js';
import { sendblue } from '../src/index.js';

const enabled = process.env['SENDBLUE_LIVE_TEST'] === '1';
const markReadEnabled = process.env['SENDBLUE_TEST_MARK_READ'] === '1';
const sendblueApiBaseUrl = 'https://api.sendblue.com';

const MessageListSchema = z
  .object({
    data: z.array(
      z
        .object({
          is_outbound: z.boolean().optional(),
          message_handle: z.string().min(1).optional(),
          message_type: z.string().optional(),
          number: z.string().optional(),
          sendblue_number: z.string().nullable().optional(),
          service: z.string().optional(),
        })
        .loose(),
    ),
  })
  .loose();

describe.skipIf(!enabled)('Sendblue live API', () => {
  it('exercises the Sendblue v0.1 inbound and outbound operations', async () => {
    const apiKey = required('SENDBLUE_API_KEY');
    const apiSecret = required('SENDBLUE_API_SECRET');
    const fromNumber = required('SENDBLUE_FROM_NUMBER');
    const recipientNumber = required('SENDBLUE_TEST_RECIPIENT');
    const imageUrl = required('SENDBLUE_TEST_IMAGE_URL');
    const videoUrl = required('SENDBLUE_TEST_VIDEO_URL');
    const fileUrl = required('SENDBLUE_TEST_FILE_URL');
    const messageHandle = await waitForLatestInboundMessageHandle({
      apiKey,
      apiSecret,
      fromNumber,
      recipientNumber,
    });
    const provider = sendblue({ markReadEnabled });
    const client = createIMessageClient({
      connectionId: 'sendblue-live',
      provider,
    });
    const recipient = { kind: 'phone', value: recipientNumber } as const;
    const run = String(Date.now());

    await provider.tapbacks.add({
      conversationId: recipientNumber,
      messageId: messageHandle,
      reaction: 'like',
    });

    const conversation = await client.conversations.open({
      participants: [recipient],
    });
    if (markReadEnabled) {
      await client.conversations.markRead(conversation.id);
    }
    const text = await client.messages.send({
      conversationId: conversation.id,
      text: `imessage-sdk Sendblue live test ${run}`,
    });
    const imageResponse = await download(imageUrl);
    const fileResponse = await download(fileUrl);
    const attachments = [];
    for (const [kind, source, filename, contentType] of [
      [
        'image',
        { type: 'blob', data: await imageResponse.blob() },
        filenameFromUrl(imageUrl, 'image'),
        imageResponse.headers.get('content-type') ?? undefined,
      ],
      ['video', { type: 'url', url: videoUrl }, undefined, undefined],
      [
        'file',
        { type: 'bytes', data: new Uint8Array(await fileResponse.arrayBuffer()) },
        filenameFromUrl(fileUrl, 'file'),
        fileResponse.headers.get('content-type') ?? undefined,
      ],
    ] as const) {
      attachments.push(
        await client.messages.send({
          conversationId: conversation.id,
          text: `${kind} attachment source test`,
          attachments: [
            {
              kind,
              source,
              ...(filename === undefined ? {} : { filename }),
              ...(contentType === undefined ? {} : { contentType }),
            },
          ],
        }),
      );
    }
    const locator = {
      conversationId: conversation.id,
      messageId: text.providerMessageId,
    };

    const found = await client.messages.get(locator);
    const status = await getStatusWithDiagnostics(provider, locator);
    await client.typing.start(conversation.id);
    await delay(2_000);
    await client.typing.stop(conversation.id);

    expect(conversation.providerConversationId).toBe(recipientNumber);
    expect(text.providerMessageId).toBeTruthy();
    expect(attachments).toHaveLength(3);
    for (const attachment of attachments) {
      expect(attachment.providerMessageId).toBeTruthy();
      expect(attachment.attachments).toHaveLength(1);
    }
    expect(found?.providerMessageId).toBe(text.providerMessageId);
    expect(status?.messageId).toBe(text.providerMessageId);
    expect(text.sender.value).toBe(fromNumber);
  }, 180_000);
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required when SENDBLUE_LIVE_TEST=1.`);
  }
  return value;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function download(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download Sendblue live-test fixture: HTTP ${response.status}.`);
  }
  return response;
}

function filenameFromUrl(url: string, fallback: string): string {
  const pathname = new URL(url).pathname;
  return pathname.split('/').filter(Boolean).at(-1) ?? fallback;
}

interface LatestInboundMessageInput {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly fromNumber: string;
  readonly recipientNumber: string;
}

async function waitForLatestInboundMessageHandle(
  input: LatestInboundMessageInput,
): Promise<string> {
  const deadline = Date.now() + 30_000;

  do {
    const handle = await getLatestInboundMessageHandle(input);
    if (handle !== undefined) return handle;
    await delay(1_000);
  } while (Date.now() < deadline);

  throw new Error(
    'No inbound Sendblue message was found. Send a fresh iMessage to the configured Sendblue line, then rerun the integration test.',
  );
}

async function getLatestInboundMessageHandle(
  input: LatestInboundMessageInput,
): Promise<string | undefined> {
  const url = new URL('/api/v2/messages', sendblueApiBaseUrl);
  url.search = new URLSearchParams({
    created_at_gte: new Date(Date.now() - 5 * 60_000).toISOString(),
    is_outbound: 'false',
    limit: '1',
    message_type: 'message',
    number: input.recipientNumber,
    order_by: 'createdAt',
    order_direction: 'desc',
    sendblue_number: input.fromNumber,
    service: 'iMessage',
  }).toString();
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'sb-api-key-id': input.apiKey,
      'sb-api-secret-key': input.apiSecret,
    },
  });

  if (!response.ok) {
    throw new Error(`Could not list inbound Sendblue messages: HTTP ${response.status}.`);
  }

  const parsed = MessageListSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Sendblue returned an invalid inbound message list.');
  }

  return parsed.data.data.find(
    (message) =>
      message.is_outbound === false &&
      message.message_type === 'message' &&
      message.number === input.recipientNumber &&
      message.sendblue_number === input.fromNumber &&
      message.service?.toLowerCase() === 'imessage' &&
      message.message_handle !== undefined,
  )?.message_handle;
}

interface SendblueStatusReader {
  readonly messages: {
    getStatus(message: MessageLocator): Promise<SendblueMessageStatus | null>;
  };
}

async function getStatusWithDiagnostics(
  provider: SendblueStatusReader,
  locator: MessageLocator,
): Promise<SendblueMessageStatus | null> {
  try {
    return await provider.messages.getStatus(locator);
  } catch (error) {
    const diagnostic =
      error instanceof IMessageSDKError
        ? {
            name: error.name,
            message: redactSensitiveValues(error.message),
            code: error.code,
            statusCode: error.statusCode,
            retryable: error.retryable,
            raw: sanitizeDiagnostic(error.raw),
          }
        : {
            name: error instanceof Error ? error.name : typeof error,
            message:
              error instanceof Error
                ? redactSensitiveValues(error.message)
                : 'Non-Error value thrown.',
            raw: sanitizeDiagnostic(error),
          };

    throw new Error(
      `Sendblue status lookup failed for handle ${locator.messageId}. Sanitized diagnostic:\n${JSON.stringify(diagnostic, null, 2)}`,
      { cause: error },
    );
  }
}

function sanitizeDiagnostic(value: unknown, depth = 0): unknown {
  if (depth >= 6) return '[MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnostic(item, depth + 1));
  }
  if (typeof value === 'string') return redactSensitiveValues(value);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveDiagnosticKey(key) ? '[REDACTED]' : sanitizeDiagnostic(item, depth + 1),
    ]),
  );
}

function isSensitiveDiagnosticKey(key: string): boolean {
  return /api.?key|secret|authorization|token|credential|password|account.?email|content|media.?url|from.?number|to.?number|sendblue.?number|^number$/iu.test(
    key,
  );
}

function redactSensitiveValues(value: string): string {
  let result = value;
  for (const sensitiveValue of [
    process.env['SENDBLUE_API_KEY'],
    process.env['SENDBLUE_API_SECRET'],
    process.env['SENDBLUE_WEBHOOK_SECRET'],
    process.env['SENDBLUE_FROM_NUMBER'],
    process.env['SENDBLUE_TEST_RECIPIENT'],
  ]) {
    if (sensitiveValue !== undefined && sensitiveValue.length > 0) {
      result = result.split(sensitiveValue).join('[REDACTED]');
    }
  }
  return result;
}
