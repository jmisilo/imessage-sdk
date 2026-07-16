import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  AmbiguousDeliveryError,
  createIMessageClient,
  RateLimitError,
  ValidationError,
  WebhookVerificationError,
} from 'imessage-sdk';

import type { SendblueOptions, SendblueProvider } from '../src/index.js';
import { sendblue } from '../src/index.js';

const fromNumber = '+15550000000';
const recipientNumber = '+15551111111';
const recipient = { kind: 'phone', value: recipientNumber } as const;
const apiBaseUrl = 'https://sendblue.test';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function messageResponse(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    message_handle: 'sendblue-message-1',
    content: 'Hello',
    from_number: fromNumber,
    to_number: recipientNumber,
    number: recipientNumber,
    status: 'ACCEPTED',
    service: 'iMessage',
    is_outbound: true,
    date_sent: '2026-07-15T12:00:00.000Z',
    date_updated: '2026-07-15T12:00:01.000Z',
    media_url: '',
    message_type: 'message',
    group_id: '',
    participants: [],
    ...overrides,
  };
}

function configuredProvider(): SendblueProvider;
function configuredProvider(options: SendblueOptions<true>): SendblueProvider<true>;
function configuredProvider(options: SendblueOptions<false>): SendblueProvider<false>;
function configuredProvider(
  options: SendblueOptions<true> | SendblueOptions<false> = {},
): SendblueProvider<boolean> {
  const common = {
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    fromNumber,
    baseUrl: apiBaseUrl,
    ...options,
  };
  return options.markReadEnabled === true
    ? sendblue({ ...common, markReadEnabled: true })
    : sendblue({ ...common, markReadEnabled: false });
}

describe('Sendblue provider', () => {
  it('preserves its literal name and capability types', () => {
    const provider = configuredProvider();
    const markReadProvider = configuredProvider({ markReadEnabled: true });
    const dynamicMarkRead = Math.random() > 0.5;
    const dynamicProvider = sendblue({ markReadEnabled: dynamicMarkRead });

    expectTypeOf(provider.name).toEqualTypeOf<'sendblue'>();
    expectTypeOf(provider.capabilities.messages.attachments).toEqualTypeOf<true>();
    expectTypeOf(provider.capabilities.messages.replies).toEqualTypeOf<false>();
    expectTypeOf(provider.capabilities.conversations.groups).toEqualTypeOf<false>();
    expectTypeOf(provider.capabilities.conversations.markRead).toEqualTypeOf<false>();
    expectTypeOf(provider.capabilities.interactions.reactions).toEqualTypeOf<false>();
    expectTypeOf(provider.capabilities.interactions.typingStart).toEqualTypeOf<true>();
    expectTypeOf(provider.capabilities.interactions.typingStop).toEqualTypeOf<true>();
    expectTypeOf(provider.capabilities.interactions.readReceipts).toEqualTypeOf<false>();
    expectTypeOf(provider.capabilities.events.webhooks).toEqualTypeOf<true>();
    expectTypeOf(provider.capabilities.events.stream).toEqualTypeOf<false>();
    expectTypeOf(markReadProvider.capabilities.conversations.markRead).toEqualTypeOf<true>();
    expectTypeOf(markReadProvider.capabilities.interactions.readReceipts).toEqualTypeOf<false>();
    expectTypeOf(dynamicProvider.capabilities.conversations.markRead).toEqualTypeOf<boolean>();
    expectTypeOf(provider.tapbacks.add).toBeFunction();

    // @ts-expect-error A true capability requires an explicit true runtime option.
    const missingFlag: SendblueOptions<true> = {};
    void missingFlag;
  });

  it('reads credentials and the sending line from the environment', async () => {
    vi.stubEnv('SENDBLUE_API_KEY', 'environment-key');
    vi.stubEnv('SENDBLUE_API_SECRET', 'environment-secret');
    vi.stubEnv('SENDBLUE_FROM_NUMBER', fromNumber);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse(messageResponse(), 202);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({
      provider: sendblue({ baseUrl: apiBaseUrl }),
    });

    await client.messages.send({ to: recipient, text: 'Environment' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBaseUrl}/api/send-message`,
      expect.objectContaining({
        headers: expect.objectContaining({
          'sb-api-key-id': 'environment-key',
          'sb-api-secret-key': 'environment-secret',
        }),
      }),
    );
  });

  it('sends text and one public URL attachment', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse(
        messageResponse({
          content: 'Photo',
          media_url: 'https://cdn.test/photo.jpg',
        }),
        202,
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({
      connectionId: 'sendblue-line',
      provider: configuredProvider(),
    });

    const message = await client.messages.send({
      conversationId: recipientNumber,
      text: 'Photo',
      attachments: [
        {
          kind: 'image',
          source: { type: 'url', url: 'https://cdn.test/photo.jpg' },
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        },
      ],
    });

    expect(message).toMatchObject({
      id: 'sendblue-message-1',
      provider: 'sendblue',
      connectionId: 'sendblue-line',
      conversationId: recipientNumber,
      direction: 'outbound',
      status: 'accepted',
      providerStatus: 'ACCEPTED',
      attachments: [{ kind: 'image', url: 'https://cdn.test/photo.jpg' }],
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${apiBaseUrl}/api/send-message`);
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'content-type': 'application/json',
        'sb-api-key-id': 'test-key',
        'sb-api-secret-key': 'test-secret',
      }),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      number: recipientNumber,
      from_number: fromNumber,
      content: 'Photo',
      media_url: 'https://cdn.test/photo.jpg',
    });
  });

  it.each([
    {
      name: 'Blob',
      source: {
        type: 'blob' as const,
        data: new Blob([new Uint8Array([1, 2, 3])]),
      },
      filename: 'photo.png',
      contentType: 'image/png',
    },
    {
      name: 'Uint8Array',
      source: { type: 'bytes' as const, data: new Uint8Array([4, 5, 6]) },
      filename: 'document.pdf',
      contentType: 'application/pdf',
    },
  ])('uploads a $name attachment before sending it', async (attachment) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ media_url: `https://cdn.test/${attachment.filename}` }))
      .mockResolvedValueOnce(
        jsonResponse(
          messageResponse({
            content: '',
            media_url: `https://cdn.test/${attachment.filename}`,
          }),
          202,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({ provider: configuredProvider() });

    await client.messages.send({
      to: recipient,
      attachments: [
        {
          kind: attachment.contentType.startsWith('image/') ? 'image' : 'file',
          source: attachment.source,
          filename: attachment.filename,
          contentType: attachment.contentType,
        },
      ],
    });

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[0] ?? [];
    expect(uploadUrl).toBe(`${apiBaseUrl}/api/upload-file`);
    expect(uploadInit?.method).toBe('POST');
    expect(uploadInit?.headers).toEqual(
      expect.objectContaining({
        'sb-api-key-id': 'test-key',
        'sb-api-secret-key': 'test-secret',
      }),
    );
    expect(uploadInit?.headers).not.toEqual(
      expect.objectContaining({ 'content-type': 'application/json' }),
    );
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    const formData = uploadInit?.body as FormData;
    const uploadedFile = formData.get('file');
    expect(uploadedFile).toBeInstanceOf(Blob);
    expect(uploadedFile).toMatchObject({
      name: attachment.filename,
      type: attachment.contentType,
      size: 3,
    });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] ?? [];
    expect(sendUrl).toBe(`${apiBaseUrl}/api/send-message`);
    expect(JSON.parse(String(sendInit?.body))).toEqual({
      number: recipientNumber,
      from_number: fromNumber,
      media_url: `https://cdn.test/${attachment.filename}`,
    });
  });

  it('rejects multiple attachments, replies, groups, and idempotency keys', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse(messageResponse(), 202);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({ provider: configuredProvider() });
    const attachment = {
      kind: 'image' as const,
      source: { type: 'url' as const, url: 'https://cdn.test/photo.jpg' },
    };

    await expect(
      client.messages.send({
        to: recipient,
        attachments: [attachment, attachment],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      client.messages.send({
        to: recipient,
        text: 'Reply',
        replyTo: { messageId: 'parent-message' },
      }),
    ).rejects.toMatchObject({
      name: 'UnsupportedCapabilityError',
      capability: 'messages.replies',
    });
    await expect(
      client.messages.send({
        to: [recipient, { kind: 'phone', value: '+15552222222' }],
        text: 'Group',
      }),
    ).rejects.toMatchObject({
      name: 'UnsupportedCapabilityError',
      capability: 'conversations.groups',
    });
    await expect(
      client.messages.send({
        to: recipient,
        text: 'No idempotency support',
        idempotencyKey: 'operation-1',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates attachment URLs, upload size, text length, and empty content locally', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(messageResponse(), 202));
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({ provider: configuredProvider() });
    const oversized = new Blob([]);
    Object.defineProperty(oversized, 'size', { value: 100 * 1024 * 1024 + 1 });

    await expect(
      client.messages.send({
        to: recipient,
        attachments: [{ kind: 'file', source: { type: 'url', url: 'file:///secret.txt' } }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_attachment_url' });
    await expect(
      client.messages.send({
        to: recipient,
        attachments: [{ kind: 'file', source: { type: 'blob', data: oversized } }],
      }),
    ).rejects.toMatchObject({ code: 'attachment_too_large' });
    await expect(
      client.messages.send({ to: recipient, text: 'x'.repeat(18_997) }),
    ).rejects.toMatchObject({ code: 'message_too_long' });
    await expect(client.messages.send({ to: recipient, text: '   ' })).rejects.toMatchObject({
      code: 'message_content_required',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gets a message and its current status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          messageResponse({
            status: 'DELIVERED',
            date_delivered: '2026-07-15T12:00:02.000Z',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          messageResponse({
            status: 'READ',
            date_read: '2026-07-15T12:00:03.000Z',
            was_downgraded: true,
          }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({ provider: configuredProvider() });
    const locator = {
      conversationId: recipientNumber,
      messageId: 'sendblue-message-1',
    };

    const message = await client.messages.get(locator);
    const status = await client.providers.sendblue.messages.getStatus(locator);

    expect(message).toMatchObject({
      providerMessageId: 'sendblue-message-1',
      conversationId: recipientNumber,
      status: 'delivered',
      service: 'imessage',
    });
    expect(status).toMatchObject({
      messageId: 'sendblue-message-1',
      conversationId: recipientNumber,
      status: 'read',
      providerStatus: 'READ',
      service: 'sms',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${apiBaseUrl}/api/v2/messages/sendblue-message-1`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${apiBaseUrl}/api/v2/messages/sendblue-message-1`);
  });

  it('rejects a status response without a provider status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          message_handle: 'sendblue-message-1',
          number: recipientNumber,
        }),
      ),
    );
    const provider = configuredProvider();

    await expect(
      provider.messages.getStatus({
        conversationId: recipientNumber,
        messageId: 'sendblue-message-1',
      }),
    ).rejects.toMatchObject({
      name: 'IMessageSDKError',
      code: 'invalid_provider_response',
    });
  });

  it('maps an uncertain send result to AmbiguousDeliveryError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('network unavailable'))),
    );
    const client = createIMessageClient({ provider: configuredProvider() });

    await expect(
      client.messages.send({ to: recipient, text: 'Maybe accepted' }),
    ).rejects.toMatchObject({
      name: AmbiguousDeliveryError.name,
      provider: 'sendblue',
      code: 'ambiguous_delivery',
      retryable: true,
    });
  });

  it.each([408, 500, 503])(
    'maps an uncertain send HTTP %s response to AmbiguousDeliveryError',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          jsonResponse({ status: 'ERROR', error_message: 'Upstream failure' }, status),
        ),
      );
      const client = createIMessageClient({ provider: configuredProvider() });

      await expect(
        client.messages.send({ to: recipient, text: 'Maybe accepted' }),
      ).rejects.toMatchObject({
        name: AmbiguousDeliveryError.name,
        provider: 'sendblue',
        code: `http_${status}`,
        statusCode: status,
        retryable: true,
      });
    },
  );

  it('maps a successful send without a message handle to AmbiguousDeliveryError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'ACCEPTED' }, 202)),
    );
    const client = createIMessageClient({ provider: configuredProvider() });

    await expect(
      client.messages.send({ to: recipient, text: 'Accepted without an ID' }),
    ).rejects.toMatchObject({
      name: AmbiguousDeliveryError.name,
      provider: 'sendblue',
      code: 'ambiguous_delivery',
      retryable: true,
    });
  });

  it('maps a send response-body failure to AmbiguousDeliveryError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 202,
            headers: new Headers(),
            text: async () => Promise.reject(new TypeError('connection closed')),
          }) as Response,
      ),
    );
    const client = createIMessageClient({ provider: configuredProvider() });

    await expect(
      client.messages.send({ to: recipient, text: 'Maybe accepted' }),
    ).rejects.toMatchObject({
      name: AmbiguousDeliveryError.name,
      code: 'ambiguous_delivery',
      retryable: true,
    });
  });

  it('maps HTTP 429 responses and retry-after metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ status: 'ERROR', error_message: 'Too many requests' }, 429, {
          'retry-after': '12',
        }),
      ),
    );
    const client = createIMessageClient({ provider: configuredProvider() });

    await expect(
      client.messages.get({
        conversationId: recipientNumber,
        messageId: 'sendblue-message-1',
      }),
    ).rejects.toMatchObject({
      name: RateLimitError.name,
      provider: 'sendblue',
      statusCode: 429,
      retryable: true,
      retryAfter: 12,
    });
  });

  it('starts and stops typing and exposes add-only tapbacks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ status: 'SENT' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({ provider: configuredProvider() });
    const locator = {
      conversationId: recipientNumber,
      messageId: 'sendblue-message-1',
    };

    await client.typing.start(recipientNumber);
    await client.typing.stop(recipientNumber);
    await client.providers.sendblue.tapbacks.add({
      ...locator,
      reaction: 'like',
      partIndex: 1,
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${apiBaseUrl}/api/send-typing-indicator`,
      `${apiBaseUrl}/api/send-typing-indicator`,
      `${apiBaseUrl}/api/send-reaction`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      number: recipientNumber,
      from_number: fromNumber,
      state: 'start',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      number: recipientNumber,
      from_number: fromNumber,
      state: 'stop',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      from_number: fromNumber,
      message_handle: 'sendblue-message-1',
      reaction: 'like',
      part_index: 1,
    });
    await expect(client.reactions.add({ ...locator, reaction: 'like' })).rejects.toMatchObject({
      name: 'UnsupportedCapabilityError',
      capability: 'reactions.add',
    });
    await expect(
      client.providers.sendblue.tapbacks.add({
        ...locator,
        reaction: 'like',
        partIndex: -1,
      }),
    ).rejects.toMatchObject({ code: 'invalid_part_index' });
  });

  it('does not treat a 2xx operation-level error as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'ERROR', error_message: 'No route mapping found' })),
    );
    const client = createIMessageClient({ provider: configuredProvider() });

    await expect(client.typing.start(recipientNumber)).rejects.toMatchObject({
      name: 'IMessageSDKError',
      code: 'sendblue_operation_failed',
      raw: { status: 'ERROR', error_message: 'No route mapping found' },
    });
  });

  it('keeps mark-read disabled by default and enables it explicitly', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ status: 'SENT' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const disabledClient = createIMessageClient({ provider: configuredProvider() });

    await expect(disabledClient.conversations.markRead(recipientNumber)).rejects.toMatchObject({
      name: 'UnsupportedCapabilityError',
      capability: 'conversations.markRead',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const enabledClient = createIMessageClient({
      provider: configuredProvider({ markReadEnabled: true }),
    });
    await enabledClient.conversations.markRead(recipientNumber);

    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBaseUrl}/api/mark-read`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          number: recipientNumber,
          from_number: fromNumber,
        }),
      }),
    );
  });

  it('verifies the webhook secret and filters events for other configured lines', async () => {
    const provider = configuredProvider({ webhookSecret: 'webhook-secret' });
    const client = createIMessageClient({ provider });
    const inbound = messageResponse({
      message_handle: 'inbound-photo',
      content: '',
      from_number: recipientNumber,
      to_number: fromNumber,
      sendblue_number: fromNumber,
      is_outbound: false,
      status: 'RECEIVED',
      media_url: 'https://cdn.test/inbound.jpg',
    });

    await expect(
      client.webhooks.handle(webhookRequest(inbound, 'wrong-secret')),
    ).rejects.toBeInstanceOf(WebhookVerificationError);

    const events = await client.webhooks.handle(webhookRequest(inbound));
    const ignored = await client.webhooks.handle(
      webhookRequest({ ...inbound, sendblue_number: '+15553333333' }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'message.received',
      provider: 'sendblue',
      message: {
        providerMessageId: 'inbound-photo',
        conversationId: recipientNumber,
        direction: 'inbound',
        sender: recipient,
        recipients: [{ kind: 'phone', value: fromNumber }],
        text: '',
        status: 'delivered',
        service: 'imessage',
        attachments: [
          {
            kind: 'image',
            url: 'https://cdn.test/inbound.jpg',
          },
        ],
      },
      raw: inbound,
    });
    expect(ignored).toEqual([]);

    await expect(
      client.webhooks.handle(
        webhookRequest({
          ...inbound,
          sendblue_number: null,
          to_number: null,
        }),
      ),
    ).resolves.toEqual([]);
  });

  it('requires a configured line before normalizing account-wide webhooks', async () => {
    const client = createIMessageClient({
      provider: sendblue({
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        webhookSecret: 'webhook-secret',
        baseUrl: apiBaseUrl,
      }),
    });

    await expect(client.webhooks.handle(webhookRequest(messageResponse()))).rejects.toMatchObject({
      name: ValidationError.name,
      code: 'missing_from_number',
    });
  });

  it.each([
    ['ACCEPTED', 'message.sent', 'accepted'],
    ['SENT', 'message.sent', 'sent'],
    ['DELIVERED', 'message.delivered', 'delivered'],
    ['ERROR', 'message.failed', 'failed'],
  ] as const)('maps outbound %s webhooks', async (status, eventType, messageStatus) => {
    const client = createIMessageClient({
      provider: configuredProvider({ webhookSecret: 'webhook-secret' }),
    });
    const events = await client.webhooks.handle(
      webhookRequest(messageResponse({ status, is_outbound: true })),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: eventType,
      message: {
        direction: 'outbound',
        status: messageStatus,
        providerStatus: status,
      },
    });
  });

  it('ignores undocumented outbound read-receipt webhooks', async () => {
    const client = createIMessageClient({
      provider: configuredProvider({ webhookSecret: 'webhook-secret' }),
    });

    await expect(
      client.webhooks.handle(
        webhookRequest(messageResponse({ status: 'READ', is_outbound: true })),
      ),
    ).resolves.toEqual([]);
  });

  it('normalizes typing-started and typing-stopped webhooks', async () => {
    const client = createIMessageClient({
      provider: configuredProvider({ webhookSecret: 'webhook-secret' }),
    });

    const started = await client.webhooks.handle(
      webhookRequest({
        number: recipientNumber,
        from_number: fromNumber,
        is_typing: true,
        timestamp: '2026-07-15T12:00:00.000Z',
      }),
    );
    const stopped = await client.webhooks.handle(
      webhookRequest({
        number: recipientNumber,
        from_number: fromNumber,
        is_typing: false,
        timestamp: '2026-07-15T12:00:01.000Z',
      }),
    );

    expect(started[0]).toMatchObject({
      type: 'typing.started',
      conversationId: recipientNumber,
      actor: recipient,
    });
    expect(stopped[0]).toMatchObject({
      type: 'typing.stopped',
      conversationId: recipientNumber,
      actor: recipient,
    });
  });

  it('ignores malformed and unsupported webhook payloads', async () => {
    const client = createIMessageClient({
      provider: configuredProvider({ webhookSecret: 'webhook-secret' }),
    });

    await expect(client.webhooks.handle(webhookRequest({}))).resolves.toEqual([]);
    await expect(
      client.webhooks.handle(
        webhookRequest({
          message_handle: 42,
          is_outbound: 'no',
          is_typing: 'sometimes',
        }),
      ),
    ).resolves.toEqual([]);
    await expect(
      client.webhooks.handle(
        new Request('https://example.test/sendblue', {
          method: 'POST',
          headers: { 'sb-signing-secret': 'webhook-secret' },
          body: '{not-json',
        }),
      ),
    ).resolves.toEqual([]);
  });
});

function webhookRequest(body: unknown, secret = 'webhook-secret'): Request {
  return new Request('https://example.test/sendblue', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sb-signing-secret': secret,
    },
    body: JSON.stringify(body),
  });
}
