import type {
  AdvancedIMessage,
  CatchUpEvent,
  Chat,
  Message,
  MessageEvent,
} from '@photon-ai/advanced-imessage';

import { AuthenticationError as PhotonAuthenticationError } from '@photon-ai/advanced-imessage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIMessageClient } from 'imessage-sdk';

import { photon } from '../src/index.js';

const moduleMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  issueTokens: vi.fn(),
}));

vi.mock('@photon-ai/advanced-imessage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@photon-ai/advanced-imessage')>();
  return { ...actual, createClient: moduleMocks.createClient };
});

vi.mock('@spectrum-ts/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spectrum-ts/core')>();
  return {
    ...actual,
    cloud: { ...actual.cloud, issueImessageTokens: moduleMocks.issueTokens },
  };
});

const ownPhone = '+15550000000';
const recipientPhone = '+15551111111';
const chat: Chat = {
  guid: `any;-;${recipientPhone}`,
  displayName: 'Recipient',
  isArchived: false,
  isFiltered: false,
  isGroup: false,
  participants: [{ address: recipientPhone, service: 'iMessage' }],
  service: 'iMessage',
};

function photonMessage(overrides: Partial<Message> = {}): Message {
  return {
    appliedReactions: [],
    chatGuids: [chat.guid],
    content: { attachments: [], formatting: [], mentions: [], text: 'Hello' },
    dataDetectorResultsPresent: false,
    dateCreated: new Date('2026-01-01T00:00:00.000Z'),
    didNotifyRecipient: false,
    guid: 'photon-message-1',
    isArchived: false,
    isAudioMessage: false,
    isAutoReply: false,
    isCorrupt: false,
    isDelayed: false,
    isDelivered: false,
    isDeliveredQuietly: false,
    isExpirable: false,
    isForward: false,
    isFromMe: true,
    isSent: true,
    isServiceMessage: false,
    isSpam: false,
    isSystemMessage: false,
    itemType: 'normal',
    placedStickers: [],
    sendErrorCode: 0,
    ...overrides,
  };
}

function stream<T>(values: readonly T[]) {
  const close = vi.fn(async () => undefined);
  return {
    close,
    async *[Symbol.asyncIterator]() {
      for (const value of values) yield value;
    },
  };
}

function mockPhotonClient() {
  const sendText = vi.fn(async () => photonMessage());
  const sendAttachment = vi.fn(async () => photonMessage());
  const sendMultipart = vi.fn(async () => photonMessage());
  const getMessage = vi.fn(async () => photonMessage());
  const setReaction = vi.fn(async () => photonMessage());
  const upload = vi.fn(async (input: { fileName: string; data: Uint8Array }) => ({
    attachment: {
      fileName: input.fileName,
      guid: `attachment-${input.fileName}`,
      isHidden: false,
      isOutgoing: true,
      isSticker: false,
      mimeType: 'application/octet-stream',
      totalBytes: input.data.byteLength,
      transferState: 'finished' as const,
      uti: 'public.data',
    },
  }));
  const attachmentDownload = stream([
    {
      type: 'header' as const,
      info: {
        fileName: 'photo.jpg',
        guid: 'attachment-photo',
        isHidden: false,
        isOutgoing: false,
        isSticker: false,
        mimeType: 'image/jpeg',
        totalBytes: 3,
        transferState: 'finished' as const,
        uti: 'public.jpeg',
      },
    },
    { type: 'primaryChunk' as const, data: new Uint8Array([1, 2]) },
    { type: 'primaryChunk' as const, data: new Uint8Array([3]) },
    { type: 'companionChunk' as const, data: new Uint8Array([9]) },
  ]);
  const downloadStream = vi.fn(() => attachmentDownload);
  const createChat = vi.fn(async () => ({ chat }));
  const getChat = vi.fn(async () => chat);
  const markRead = vi.fn(async () => undefined);
  const setTyping = vi.fn(async () => undefined);
  const subscribeEvents = vi.fn(() => stream<MessageEvent>([]));
  const catchUp = vi.fn(() => stream<CatchUpEvent>([]));
  const close = vi.fn(async () => undefined);
  const client = {
    attachments: { downloadStream, upload },
    chats: {
      create: createChat,
      get: getChat,
      markRead,
      setTyping,
    },
    messages: {
      get: getMessage,
      sendAttachment,
      sendMultipart,
      sendText,
      setReaction,
      subscribeEvents,
    },
    events: { catchUp },
    close,
  } as unknown as AdvancedIMessage;

  return {
    catchUp,
    client,
    close,
    createChat,
    getChat,
    getMessage,
    downloadStream,
    downloadStreamClose: attachmentDownload.close,
    markRead,
    sendAttachment,
    sendMultipart,
    sendText,
    setReaction,
    setTyping,
    subscribeEvents,
    upload,
  };
}

let sdk = mockPhotonClient();

beforeEach(() => {
  sdk = mockPhotonClient();
  moduleMocks.issueTokens.mockReset();
  moduleMocks.issueTokens.mockResolvedValue({
    type: 'dedicated',
    expiresIn: 3_600,
    auth: { 'instance-1': 'line-token' },
    numbers: { 'instance-1': ownPhone },
  });
  moduleMocks.createClient.mockReset();
  moduleMocks.createClient.mockReturnValue(sdk.client);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Photon provider', () => {
  it('reads project credentials from the environment', async () => {
    vi.stubEnv('PHOTON_PROJECT_ID', 'environment-project');
    vi.stubEnv('PHOTON_PROJECT_SECRET', 'environment-secret');
    const provider = photon();

    await provider.connection.getLine();

    expect(moduleMocks.issueTokens).toHaveBeenCalledWith(
      'environment-project',
      'environment-secret',
    );
  });

  it('discovers one cloud line lazily and preserves provider typing', async () => {
    const provider = photon({ projectId: 'project', projectSecret: 'secret' });
    const client = createIMessageClient({ provider });

    expect(moduleMocks.issueTokens).not.toHaveBeenCalled();
    await expect(client.providers.photon.connection.getLine()).resolves.toEqual({
      phone: ownPhone,
      instanceId: 'instance-1',
      type: 'dedicated',
    });
    expect(moduleMocks.createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'instance-1.imsg.photon.codes:443',
        autoIdempotency: true,
        tls: true,
      }),
    );
    const token = moduleMocks.createClient.mock.calls[0]?.[0].token;
    expect(typeof token).toBe('function');
    if (typeof token === 'function') await expect(token()).resolves.toBe('line-token');

    await client.close();
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it('requires a phone when multiple dedicated lines are available', async () => {
    moduleMocks.issueTokens.mockResolvedValue({
      type: 'dedicated',
      expiresIn: 3_600,
      auth: { one: 'one-token', two: 'two-token' },
      numbers: { one: ownPhone, two: '+15552222222' },
    });
    const client = createIMessageClient({
      provider: photon({ projectId: 'project', projectSecret: 'secret' }),
    });

    await expect(client.providers.photon.connection.getLine()).rejects.toMatchObject({
      code: 'photon_phone_required',
    });
  });

  it('explains when Photon does not permit the recipient for the project', async () => {
    sdk.createChat.mockRejectedValueOnce(
      new PhotonAuthenticationError('[spectrum-imessage] Target not allowed for this project', {
        code: 'unauthorized',
        grpcCode: 7,
        retryable: false,
      }),
    );
    const client = createIMessageClient({
      provider: photon({ projectId: 'project', projectSecret: 'secret' }),
    });

    await expect(
      client.conversations.open({
        participants: [{ kind: 'phone', value: recipientPhone }],
      }),
    ).rejects.toMatchObject({
      name: 'AuthenticationError',
      code: 'photon_target_not_allowed',
      retryable: false,
    });
  });

  it('maps a processed idempotency key to a duplicate conflict', async () => {
    sdk.sendText.mockRejectedValueOnce(
      new Error('[upstream] Operation already processed with this client message ID'),
    );
    const client = createIMessageClient({
      provider: photon({ projectId: 'project', projectSecret: 'secret' }),
    });

    await expect(
      client.messages.send({
        conversationId: chat.guid,
        text: 'Duplicate',
        idempotencyKey: 'same-operation',
      }),
    ).rejects.toMatchObject({
      name: 'ConflictError',
      code: 'duplicate_message',
      retryable: false,
    });
  });

  it('maps an unknown Photon server failure as retryable unavailability', async () => {
    sdk.createChat.mockRejectedValueOnce(new Error('Unknown server error occurred'));
    const client = createIMessageClient({
      provider: photon({ projectId: 'project', projectSecret: 'secret' }),
    });

    await expect(
      client.conversations.open({
        participants: [{ kind: 'phone', value: recipientPhone }],
      }),
    ).rejects.toMatchObject({
      name: 'ProviderUnavailableError',
      code: 'photon_server_error',
      retryable: true,
    });
  });

  it('keeps experimental Photon capabilities disabled in v0.1', async () => {
    const client = createIMessageClient({
      provider: photon({ projectId: 'project', projectSecret: 'secret' }),
    });

    expect(client.capabilities.messages.edit).toBe(false);
    expect(client.capabilities.messages.delete).toBe(false);
    expect(client.capabilities.conversations.groups).toBe(false);
    expect(client.capabilities.events.stream).toBe(false);
    await expect(
      client.messages.edit(
        { conversationId: chat.guid, messageId: 'photon-message-1' },
        { text: 'Corrected' },
      ),
    ).rejects.toMatchObject({
      name: 'UnsupportedCapabilityError',
      code: 'unsupported_capability',
      capability: 'messages.edit',
    });
    await expect(
      client.messages.delete({
        conversationId: chat.guid,
        messageId: 'photon-message-1',
      }),
    ).rejects.toMatchObject({
      name: 'UnsupportedCapabilityError',
      code: 'unsupported_capability',
      capability: 'messages.delete',
    });
    await expect(
      client.conversations.open({
        participants: [
          { kind: 'phone', value: recipientPhone },
          { kind: 'phone', value: '+15552222222' },
        ],
      }),
    ).rejects.toMatchObject({
      name: 'UnsupportedCapabilityError',
      capability: 'conversations.groups',
    });
    expect(() => client.events.subscribe()).toThrow(
      expect.objectContaining({
        name: 'UnsupportedCapabilityError',
        capability: 'events.subscribe',
      }),
    );
  });

  it('sends text, uploads byte attachments, and maps native results', async () => {
    const client = createIMessageClient({
      connectionId: 'photon-line',
      provider: photon({ projectId: 'project', projectSecret: 'secret' }),
    });

    const text = await client.messages.send({
      to: { kind: 'phone', value: recipientPhone },
      text: 'Hello',
      idempotencyKey: 'text-1',
    });
    const attachment = await client.messages.send({
      conversationId: chat.guid,
      text: 'Files',
      attachments: [
        {
          kind: 'file',
          filename: 'document.pdf',
          source: { type: 'bytes', data: new Uint8Array([1, 2, 3]) },
        },
      ],
      replyTo: { messageId: 'parent', partIndex: 1 },
      idempotencyKey: 'attachment-1',
    });

    expect(text).toMatchObject({
      provider: 'photon',
      connectionId: 'photon-line',
      providerMessageId: 'photon-message-1',
      direction: 'outbound',
      status: 'sent',
    });
    expect(sdk.createChat).toHaveBeenCalledWith([recipientPhone], {
      clientMessageId: 'text-1:chat',
    });
    expect(sdk.sendText).toHaveBeenCalledWith(chat.guid, 'Hello', {
      clientMessageId: 'text-1',
    });
    expect(sdk.upload).toHaveBeenCalledWith({
      fileName: 'document.pdf',
      data: new Uint8Array([1, 2, 3]),
    });
    expect(sdk.sendMultipart).toHaveBeenCalledWith(
      chat.guid,
      [
        { text: 'Files' },
        {
          attachmentGuid: 'attachment-document.pdf',
          attachmentName: 'document.pdf',
        },
      ],
      {
        clientMessageId: 'attachment-1',
        replyTo: { guid: 'parent', partIndex: 1 },
      },
    );
    expect(attachment.provider).toBe('photon');
  });

  it('downloads primary attachment bytes and closes the Photon stream', async () => {
    const client = createIMessageClient({
      provider: photon({ projectId: 'project', projectSecret: 'secret' }),
    });

    const data = await client.attachments.download('attachment-photo');

    expect(data).toEqual(new Uint8Array([1, 2, 3]));
    expect(sdk.downloadStream).toHaveBeenCalledWith('attachment-photo');
    expect(sdk.downloadStreamClose).toHaveBeenCalledOnce();
  });

  it('maps conversations, reactions, typing, and mark-read', async () => {
    const client = createIMessageClient({
      provider: photon({ projectId: 'project', projectSecret: 'secret' }),
    });
    const locator = { conversationId: chat.guid, messageId: 'photon-message-1' };

    const opened = await client.conversations.open({
      participants: [{ kind: 'phone', value: recipientPhone }],
    });
    const found = await client.messages.get(locator);
    await client.reactions.add({ ...locator, reaction: 'like' });
    await client.reactions.remove({ ...locator, reaction: 'like' });
    await client.typing.start(chat.guid);
    await client.typing.stop(chat.guid);
    await client.conversations.markRead(chat.guid);

    expect(opened.providerConversationId).toBe(chat.guid);
    expect(found?.providerMessageId).toBe('photon-message-1');
    expect(sdk.setReaction).toHaveBeenNthCalledWith(
      1,
      chat.guid,
      'photon-message-1',
      { kind: 'like' },
      true,
      undefined,
    );
    expect(sdk.setReaction).toHaveBeenNthCalledWith(
      2,
      chat.guid,
      'photon-message-1',
      { kind: 'like' },
      false,
      undefined,
    );
    expect(sdk.setTyping).toHaveBeenNthCalledWith(1, chat.guid, true);
    expect(sdk.setTyping).toHaveBeenNthCalledWith(2, chat.guid, false);
    expect(sdk.markRead).toHaveBeenCalledWith(chat.guid);
  });

  it('catches up before draining live events and deduplicates sequences', async () => {
    const received = {
      type: 'message.received',
      sequence: 7,
      chatGuid: chat.guid,
      isFromMe: false,
      occurredAt: new Date('2026-01-01T00:00:07.000Z'),
      actor: { address: recipientPhone, service: 'iMessage' },
      message: photonMessage({
        guid: 'received-7',
        isFromMe: false,
        isSent: false,
        sender: { address: recipientPhone, service: 'iMessage' },
      }),
    } as const satisfies MessageEvent;
    const reaction = {
      type: 'message.reactionAdded',
      sequence: 8,
      chatGuid: chat.guid,
      isFromMe: false,
      occurredAt: new Date('2026-01-01T00:00:08.000Z'),
      actor: { address: recipientPhone, service: 'iMessage' },
      messageGuid: 'photon-message-1',
      reaction: { kind: 'like' },
    } as const satisfies MessageEvent;
    const read = {
      type: 'message.read',
      sequence: 9,
      chatGuid: chat.guid,
      isFromMe: false,
      occurredAt: new Date('2026-01-01T00:00:09.000Z'),
      actor: { address: recipientPhone, service: 'iMessage' },
      messageGuid: 'photon-message-1',
      readAt: new Date('2026-01-01T00:00:09.000Z'),
    } as const satisfies MessageEvent;
    sdk.catchUp.mockReturnValue(
      stream<CatchUpEvent>([received, reaction, { type: 'catchup.complete', headSequence: 8 }]),
    );
    sdk.subscribeEvents.mockReturnValue(stream<MessageEvent>([reaction, read]));
    const provider = photon({ projectId: 'project', projectSecret: 'secret' });

    const events = [];
    for await (const event of provider.events.subscribe({ cursor: '6' })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'message.received',
      'reaction.added',
      'message.read',
    ]);
    expect(events.map((event) => event.providerEventId)).toEqual(['7', '8', '9']);
  });

  it('verifies and parses Spectrum webhooks', async () => {
    const secret = 'spectrum-secret';
    const timestamp = 1_700_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(timestamp * 1_000);
    const provider = photon({
      projectId: 'project',
      projectSecret: 'secret',
      webhookSecret: secret,
    });
    const client = createIMessageClient({ provider });
    const body = JSON.stringify({
      event: 'messages',
      space: { id: chat.guid, phone: ownPhone },
      message: {
        id: 'webhook-message-1',
        direction: 'inbound',
        timestamp: '2023-11-14T22:13:20.000Z',
        sender: { id: recipientPhone },
        space: { id: chat.guid, phone: ownPhone },
        content: { type: 'text', text: 'Webhook hello' },
      },
    });
    const digest = await signature(secret, `v0:${timestamp}:${body}`);
    const request = new Request('https://example.test/photon', {
      method: 'POST',
      headers: {
        'x-spectrum-timestamp': String(timestamp),
        'x-spectrum-signature': `v0=${digest}`,
        'x-spectrum-webhook-id': 'webhook-1',
      },
      body,
    });

    const events = await client.webhooks.handle(request);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'photon',
      providerEventId: 'webhook-1',
      type: 'message.received',
      message: { text: 'Webhook hello', conversationId: chat.guid },
    });

    const attachmentBody = JSON.stringify({
      event: 'messages',
      space: { id: chat.guid, phone: ownPhone },
      message: {
        id: 'webhook-message-2',
        direction: 'inbound',
        timestamp: '2023-11-14T22:13:20.000Z',
        sender: { id: recipientPhone },
        space: { id: chat.guid, phone: ownPhone },
        content: {
          type: 'attachment',
          id: 'attachment-photo',
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
          size: 3,
        },
      },
    });
    const attachmentDigest = await signature(secret, `v0:${timestamp}:${attachmentBody}`);
    const attachmentEvents = await client.webhooks.handle(
      new Request('https://example.test/photon', {
        method: 'POST',
        headers: {
          'x-spectrum-timestamp': String(timestamp),
          'x-spectrum-signature': `v0=${attachmentDigest}`,
          'x-spectrum-webhook-id': 'webhook-2',
        },
        body: attachmentBody,
      }),
    );

    expect(attachmentEvents[0]).toMatchObject({
      provider: 'photon',
      providerEventId: 'webhook-2',
      type: 'message.received',
      message: {
        conversationId: chat.guid,
        attachments: [
          {
            id: 'attachment-photo',
            kind: 'image',
            filename: 'photo.jpg',
            contentType: 'image/jpeg',
            size: 3,
          },
        ],
      },
    });
    expect(moduleMocks.issueTokens).not.toHaveBeenCalled();
  });
});

async function signature(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
