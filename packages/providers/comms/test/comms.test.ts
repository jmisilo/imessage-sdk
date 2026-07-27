import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  AmbiguousDeliveryError,
  AuthenticationError,
  createIMessageClient,
  RateLimitError,
  UnsupportedCapabilityError,
  ValidationError,
} from 'imessage-sdk';

import type { CommsProvider } from '../src/index.js';
import { comms } from '../src/index.js';

const apiBaseUrl = 'https://comms.test/api/v1/comms';
const recipientNumber = '+15551111111';
const recipient = { kind: 'phone', value: recipientNumber } as const;

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

function configuredProvider(): CommsProvider {
  return comms({ apiKey: 'test-key', baseUrl: apiBaseUrl });
}

function message(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: 'msg_123',
    body: 'Hello',
    direction: 'outbound',
    conversation_id: 'conv_123',
    to: recipientNumber,
    channel: 'imessage',
    status: 'accepted',
    created_at: '2026-07-27T10:00:00.000Z',
    ...overrides,
  };
}

describe('Comms provider', () => {
  it('preserves its literal name, capabilities, and provider-specific methods', () => {
    const provider = configuredProvider();

    expectTypeOf(provider.name).toEqualTypeOf<'comms'>();
    expectTypeOf(provider.capabilities.messages.text).toEqualTypeOf<true>();
    expectTypeOf(provider.capabilities.messages.attachments).toEqualTypeOf<false>();
    expectTypeOf(provider.capabilities.messages.replies).toEqualTypeOf<false>();
    expectTypeOf(provider.capabilities.conversations.direct).toEqualTypeOf<true>();
    expectTypeOf(provider.capabilities.conversations.groups).toEqualTypeOf<false>();
    expectTypeOf(provider.capabilities.events.webhooks).toEqualTypeOf<false>();
    expectTypeOf(provider.messages.list).toBeFunction();
    expectTypeOf(provider.deliveryEvents.list).toBeFunction();
    expectTypeOf(provider.webhookEndpoints.create).toBeFunction();
  });

  it('reads the API key from COMMS_API_KEY', async () => {
    vi.stubEnv('COMMS_API_KEY', 'environment-key');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ message: message(), duplicate: false }, 202);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({
      provider: comms({ baseUrl: apiBaseUrl }),
    });

    await client.messages.send({ to: recipient, text: 'Environment' });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer environment-key');
  });

  it('sends direct text with an idempotency key', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ message: message(), duplicate: false }, 202);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({
      connectionId: 'comms-line',
      provider: configuredProvider(),
    });

    const sent = await client.messages.send({
      to: recipient,
      text: 'Hello',
      idempotencyKey: 'send-123',
    });

    expect(sent).toMatchObject({
      id: 'msg_123',
      provider: 'comms',
      connectionId: 'comms-line',
      providerMessageId: 'msg_123',
      conversationId: 'conv_123',
      direction: 'outbound',
      text: 'Hello',
      service: 'imessage',
      status: 'accepted',
      providerStatus: 'accepted',
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${apiBaseUrl}/messages`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('send-123');
    expect(JSON.parse(String(init?.body))).toEqual({
      to: recipientNumber,
      body: 'Hello',
    });
  });

  it('continues native conversations and treats direct open IDs as phone destinations', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ message: message(), duplicate: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({ provider: configuredProvider() });

    const conversation = await client.conversations.open({
      participants: [recipient],
    });
    await client.messages.send({
      conversationId: conversation.id,
      text: 'First',
    });
    await client.messages.send({
      conversationId: 'conv_123',
      text: 'Continue',
    });

    expect(conversation.id).toBe(recipientNumber);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      to: recipientNumber,
      body: 'First',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      conversation_id: 'conv_123',
      body: 'Continue',
    });
  });

  it('allows provider-specific channel selection', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({
        message: message({ channel: 'sms' }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = configuredProvider();

    const sent = await provider.messages.send({
      to: recipient,
      text: 'Use SMS',
      channel: 'sms',
    });

    expect(sent.service).toBe('sms');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      to: recipientNumber,
      body: 'Use SMS',
      channel: 'sms',
    });
  });

  it('lists messages, conversations, contacts, delivery events, and webhook endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ messages: [message()] }))
      .mockResolvedValueOnce(jsonResponse({ conversations: [{ id: 'conv_123', state: 'open' }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          contacts: [
            {
              id: 'contact_123',
              phone: recipientNumber,
              name: 'Alex',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          deliveries: [
            {
              id: 'evt_123',
              event: 'message.delivered',
              status: 'delivered',
              attempts: 1,
              last_status: '200',
              created_at: '2026-07-27T10:01:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          webhooks: [
            {
              id: 'webhook_123',
              url: 'https://example.com/comms',
              events: ['message.received'],
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = configuredProvider();

    const messages = await provider.messages.list({
      conversationId: 'conv_123',
      direction: 'outbound',
      since: new Date('2026-07-27T09:00:00.000Z'),
      limit: 10,
    });
    const conversations = await provider.conversations.list({
      state: 'open',
      query: recipientNumber,
      limit: 5,
    });
    const contacts = await provider.contacts.list({ query: 'Alex', limit: 5 });
    const events = await provider.deliveryEvents.list({ limit: 3 });
    const webhooks = await provider.webhookEndpoints.list();

    expect(messages[0]).toMatchObject({
      id: 'msg_123',
      conversationId: 'conv_123',
      direction: 'outbound',
    });
    expect(conversations[0]).toMatchObject({ id: 'conv_123', state: 'open' });
    expect(contacts[0]).toMatchObject({
      id: 'contact_123',
      phone: recipientNumber,
      name: 'Alex',
    });
    expect(events[0]).toMatchObject({
      id: 'evt_123',
      event: 'message.delivered',
      attempts: 1,
    });
    expect(webhooks[0]).toMatchObject({
      id: 'webhook_123',
      url: 'https://example.com/comms',
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${apiBaseUrl}/messages?conversation_id=conv_123&since=2026-07-27T09%3A00%3A00.000Z&direction=outbound&limit=10`,
      `${apiBaseUrl}/conversations?state=open&q=%2B15551111111&limit=5`,
      `${apiBaseUrl}/contacts?q=Alex&limit=5`,
      `${apiBaseUrl}/events?limit=3`,
      `${apiBaseUrl}/webhooks`,
    ]);
  });

  it('upserts contacts through the provider-specific API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse(
        {
          contact: {
            id: 'contact_123',
            phone: recipientNumber,
            name: 'Alex',
            email: 'alex@example.com',
            tags: ['vip'],
          },
        },
        201,
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = configuredProvider();

    const contact = await provider.contacts.upsert({
      phone: recipientNumber,
      name: 'Alex',
      email: 'alex@example.com',
      tags: ['vip'],
    });

    expect(contact).toMatchObject({
      id: 'contact_123',
      phone: recipientNumber,
      name: 'Alex',
      tags: ['vip'],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      phone: recipientNumber,
      name: 'Alex',
      email: 'alex@example.com',
      tags: ['vip'],
    });
  });

  it('creates provider-specific webhook endpoints without enabling normalized webhooks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse(
        {
          webhook: {
            id: 'webhook_123',
            url: 'https://example.com/comms',
            events: ['message.received'],
          },
        },
        201,
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = configuredProvider();
    const client = createIMessageClient({ provider });

    const endpoint = await provider.webhookEndpoints.create({
      url: 'https://example.com/comms',
      events: ['message.received'],
    });

    expect(endpoint.id).toBe('webhook_123');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      url: 'https://example.com/comms',
      events: ['message.received'],
    });
    await expect(client.webhooks.handle(new Request('https://example.com'))).rejects.toBeInstanceOf(
      UnsupportedCapabilityError,
    );
  });

  it('rejects unsupported content and invalid direct destinations before calling Comms', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createIMessageClient({ provider: configuredProvider() });

    await expect(
      client.messages.send({
        to: recipient,
        attachments: [
          {
            kind: 'image',
            source: { type: 'url', url: 'https://example.com/image.png' },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(
      client.conversations.open({
        participants: [recipient, { kind: 'phone', value: '+15552222222' }],
      }),
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    await expect(
      configuredProvider().messages.send({
        to: { kind: 'email', value: 'person@example.com' },
        text: 'Hello',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps authentication and rate-limit failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Invalid API key' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'Slow down', retry_after: 30 }, 429));
    vi.stubGlobal('fetch', fetchMock);
    const provider = configuredProvider();

    await expect(
      provider.messages.list({ since: '2026-07-27T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      provider.messages.list({ since: '2026-07-27T00:00:00.000Z' }),
    ).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAfter: 30,
      retryable: true,
    } satisfies Partial<RateLimitError>);
  });

  it('rejects unbounded message-list queries', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = configuredProvider();

    await expect(
      provider.messages.list(
        // Runtime validation protects JavaScript consumers as well.
        {} as { since: string },
      ),
    ).rejects.toMatchObject({
      name: 'ValidationError',
      code: 'missing_message_list_bound',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses AmbiguousDeliveryError for uncertain sends', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Unavailable' }, 503)),
    );
    const client = createIMessageClient({ provider: configuredProvider() });

    await expect(client.messages.send({ to: recipient, text: 'Uncertain' })).rejects.toBeInstanceOf(
      AmbiguousDeliveryError,
    );
  });
});
