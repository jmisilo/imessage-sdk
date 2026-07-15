import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIMessageClient, ValidationError } from 'imessage-sdk';

import { blooio } from '../src/index.js';

const sender = { kind: 'phone', value: '+15550000000' } as const;
const recipient = { kind: 'phone', value: '+15551111111' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function signature(secret: string, timestamp: number, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const value = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('Blooio provider', () => {
  it('reads credentials and sender defaults from the environment', async () => {
    vi.stubEnv('BLOOIO_API_KEY', 'environment-key');
    vi.stubEnv('BLOOIO_FROM_NUMBER', sender.value);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ message_id: 'msg_env', status: 'queued' }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({ provider: blooio() });

    await client.messages.send({ to: recipient, text: 'Environment' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer environment-key',
        }),
        body: expect.stringContaining(`"from_number":"${sender.value}"`),
      }),
    );
  });

  it('sends text, public attachments, replies, and idempotency keys', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ message_id: 'msg_1', status: 'queued' }, 202);
    });
    const client = createIMessageClient({
      connectionId: 'main-line',
      provider: blooio({
        apiKey: 'test-key',
        sender,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const message = await client.messages.send({
      conversationId: recipient.value,
      text: 'Hello',
      attachments: [
        {
          kind: 'image',
          source: { type: 'url', url: 'https://cdn.test/photo.jpg' },
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        },
      ],
      replyTo: { messageId: 'msg_parent', partIndex: 0 },
      idempotencyKey: 'send-1',
    });

    expect(message).toMatchObject({
      id: 'msg_1',
      provider: 'blooio',
      connectionId: 'main-line',
      conversationId: recipient.value,
      status: 'pending',
      providerStatus: 'queued',
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.blooio.com/v2/api/chats/%2B15551111111/messages');
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer test-key',
        'idempotency-key': 'send-1',
      }),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: 'Hello',
      attachments: [{ url: 'https://cdn.test/photo.jpg', name: 'photo.jpg' }],
      from_number: sender.value,
      reply_to: { message_id: 'msg_parent', part_index: 0 },
    });
  });

  it('rejects non-URL attachments before making an API request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({});
    });
    const client = createIMessageClient({
      provider: blooio({
        apiKey: 'test-key',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      client.messages.send({
        to: recipient,
        attachments: [
          {
            kind: 'file',
            source: { type: 'bytes', data: new Uint8Array([1, 2, 3]) },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps get, status, conversation, reaction, typing, and read operations', async () => {
    const responses = [
      jsonResponse({
        message_id: 'msg_1',
        chat_id: recipient.value,
        direction: 'outbound',
        internal_id: sender.value,
        contact: { identifier: recipient.value },
        text: 'Hello',
        attachments: [],
        status: 'delivered',
        protocol: 'imessage',
        time_sent: 1_700_000_000_000,
        time_delivered: 1_700_000_001_000,
      }),
      jsonResponse({
        message_id: 'msg_1',
        chat_id: recipient.value,
        status: 'delivered',
        protocol: 'imessage',
        time_sent: 1_700_000_000_000,
        time_delivered: 1_700_000_001_000,
      }),
      jsonResponse({
        id: recipient.value,
        type: 'phone',
        contact: { identifier: recipient.value },
        first_message_time: 1_700_000_000_000,
      }),
      jsonResponse({ success: true }),
      jsonResponse({ success: true }),
      jsonResponse({ typing: true }),
      jsonResponse({ typing: false }),
      jsonResponse({ read: true }),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return responses.shift() ?? jsonResponse({});
    });
    const client = createIMessageClient({
      provider: blooio({
        apiKey: 'test-key',
        sender,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const locator = {
      conversationId: recipient.value,
      messageId: 'msg_1',
    };

    const message = await client.messages.get(locator);
    const status = await client.providers.blooio.messages.getStatus(locator);
    const conversation = await client.conversations.get(recipient.value);
    await client.reactions.add({ ...locator, reaction: 'love' });
    await client.reactions.remove({ ...locator, reaction: 'love' });
    await client.typing.start(recipient.value);
    await client.typing.stop(recipient.value);
    await client.conversations.markRead(recipient.value);

    expect(message).toMatchObject({ status: 'delivered', text: 'Hello' });
    expect(status).toMatchObject({ status: 'delivered', service: 'imessage' });
    expect(conversation?.participants).toEqual([recipient]);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('/chats/%2B15551111111/messages/msg_1');
    expect(urls[1]).toContain('/chats/%2B15551111111/messages/msg_1/status');
    expect(urls[2]).toContain('/chats/%2B15551111111');
    expect(urls[3]).toContain('/chats/%2B15551111111/messages/msg_1/reactions');
    expect(urls[4]).toContain('/chats/%2B15551111111/messages/msg_1/reactions');
    expect(urls[5]).toContain('/chats/%2B15551111111/typing');
    expect(urls[6]).toContain('/chats/%2B15551111111/typing');
    expect(urls[7]).toContain('/chats/%2B15551111111/read');
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      reaction: '+love',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({
      reaction: '-love',
    });
    expect(fetchMock.mock.calls[6]?.[1]?.method).toBe('DELETE');
  });

  it('verifies signatures and normalizes message, reaction, and typing webhooks', async () => {
    const secret = 'whsec_test';
    const timestamp = 1_700_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(timestamp * 1_000);
    const provider = blooio({
      webhookSecret: secret,
    });
    const client = createIMessageClient({ provider });
    const payload = JSON.stringify([
      {
        event: 'message.received',
        message_id: 'msg_in',
        external_id: recipient.value,
        internal_id: sender.value,
        sender: recipient.value,
        text: 'Inbound',
        attachments: [{ url: 'https://cdn.test/inbound.jpg', name: 'inbound.jpg' }],
        protocol: 'imessage',
        timestamp: timestamp * 1_000,
      },
      {
        event: 'message.reaction',
        action: 'add',
        reaction: 'like',
        message_id: 'msg_1',
        external_id: recipient.value,
        sender: recipient.value,
        timestamp: timestamp * 1_000,
      },
      {
        event: 'typing.started',
        external_id: recipient.value,
        sender: recipient.value,
        timestamp: timestamp * 1_000,
      },
    ]);
    const digest = await signature(secret, timestamp, payload);
    const request = new Request('https://example.test/blooio', {
      method: 'POST',
      headers: { 'x-blooio-signature': `t=${timestamp},v1=${digest}` },
      body: payload,
    });

    const events = await client.webhooks.handle(request);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: 'message.received',
      provider: 'blooio',
      message: {
        text: 'Inbound',
        direction: 'inbound',
        attachments: [
          {
            kind: 'image',
            url: 'https://cdn.test/inbound.jpg',
            filename: 'inbound.jpg',
          },
        ],
      },
    });
    expect(events[1]).toMatchObject({
      type: 'reaction.added',
      reaction: 'like',
    });
    expect(events[2]).toMatchObject({ type: 'typing.started' });
  });
});
