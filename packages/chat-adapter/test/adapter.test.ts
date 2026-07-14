import type { ChatInstance } from 'chat';

import { createMockChatInstance, createMockState } from '@chat-adapter/tests';
import { getEmoji, NotImplementedError } from 'chat';
import { describe, expect, it, vi } from 'vitest';

import type { ProviderEvent } from 'imessage-sdk';
import { createFallbackConversationId } from 'imessage-sdk';

import { createIMessageAdapter } from '../src/index.js';
import { createFakeProvider, fakeMessage, messageReceivedEvent } from './fake-provider.js';

describe('IMessageAdapter', () => {
  it('preserves the concrete provider type and opens direct conversations', async () => {
    const fake = createFakeProvider();
    const adapter = createIMessageAdapter({
      connectionId: 'main-line',
      provider: fake.provider,
    });

    const providerName: 'test-provider' = adapter.client.provider;
    const threadId = await adapter.openDM('+15551111111');

    expect(providerName).toBe('test-provider');
    expect(adapter.decodeThreadId(threadId)).toEqual({
      version: 1,
      provider: 'test-provider',
      connectionId: 'main-line',
      conversationId: 'conversation-1',
    });
    expect(fake.spies.open).toHaveBeenCalledWith({
      participants: [{ kind: 'phone', value: '+15551111111' }],
    });
  });

  it('posts text, URL attachments, and files through the normalized client', async () => {
    const fake = createFakeProvider();
    const adapter = createIMessageAdapter({ provider: fake.provider });
    await adapter.initialize(createMockChatInstance());
    const threadId = await adapter.openDM('+15551111111');

    const result = await adapter.postMessage(threadId, {
      markdown: '**Photo**',
      attachments: [
        {
          type: 'image',
          url: 'https://example.com/photo.jpg',
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
        },
      ],
      files: [
        {
          filename: 'note.txt',
          mimeType: 'text/plain',
          data: Buffer.from('hello'),
        },
      ],
    });

    expect(result.id).toBe('sent-1');
    expect(fake.spies.send).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      text: 'Photo',
      attachments: [
        {
          kind: 'file',
          source: { type: 'bytes', data: expect.any(Uint8Array) },
          filename: 'note.txt',
          contentType: 'text/plain',
        },
        {
          kind: 'image',
          source: { type: 'url', url: 'https://example.com/photo.jpg' },
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        },
      ],
    });
  });

  it('maps normalized reactions and typing operations', async () => {
    const fake = createFakeProvider();
    const adapter = createIMessageAdapter({ provider: fake.provider });
    const threadId = await adapter.openDM('+15551111111');

    await adapter.addReaction(threadId, 'message-1', getEmoji('thumbs_up'));
    await adapter.removeReaction(threadId, 'message-1', 'heart');
    await adapter.startTyping(threadId);
    await adapter.markRead(threadId);
    await adapter.disconnect();

    expect(fake.spies.addReaction).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      reaction: 'like',
    });
    expect(fake.spies.removeReaction).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      reaction: 'love',
    });
    expect(fake.spies.startTyping).toHaveBeenCalledWith('conversation-1');
    expect(fake.spies.stopTyping).toHaveBeenCalledWith('conversation-1');
    expect(fake.spies.markRead).toHaveBeenCalledWith('conversation-1');
    expect(fake.spies.close).toHaveBeenCalledOnce();
  });

  it('stops an active typing indicator after posting a message', async () => {
    const fake = createFakeProvider();
    const adapter = createIMessageAdapter({ provider: fake.provider });
    const threadId = await adapter.openDM('+15551111111');

    await adapter.startTyping(threadId);
    await adapter.postMessage(threadId, 'Hello');

    expect(fake.spies.stopTyping).toHaveBeenCalledOnce();
    expect(fake.spies.stopTyping).toHaveBeenCalledWith('conversation-1');
  });

  it('verifies and dispatches inbound webhook messages', async () => {
    const fake = createFakeProvider();
    fake.setEvents([messageReceivedEvent()]);
    const adapter = createIMessageAdapter({ provider: fake.provider });
    const processMessage = vi.fn(
      async (...arguments_: Parameters<ChatInstance['processMessage']>) => {
        void arguments_;
      },
    );
    const chat = createMockChatInstance({ overrides: { processMessage } });
    await adapter.initialize(chat);

    const response = await adapter.handleWebhook(
      new Request('https://example.com/webhooks/imessage', {
        method: 'POST',
        headers: { 'x-test-signature': 'valid' },
        body: '{}',
      }),
    );

    expect(response.status).toBe(200);
    expect(processMessage).toHaveBeenCalledOnce();
    const [, threadId, message] = processMessage.mock.calls[0] ?? [];
    expect(adapter.decodeThreadId(String(threadId)).conversationId).toBe('conversation-1');
    expect(message).toMatchObject({
      id: 'message-1',
      text: 'Hello',
      author: { userId: '+15551111111', isMe: false, isBot: false },
    });
  });

  it('rejects invalid webhook signatures', async () => {
    const fake = createFakeProvider();
    const adapter = createIMessageAdapter({ provider: fake.provider });
    const processMessage = vi.fn(
      async (...arguments_: Parameters<ChatInstance['processMessage']>) => {
        void arguments_;
      },
    );
    await adapter.initialize(createMockChatInstance({ overrides: { processMessage } }));

    const response = await adapter.handleWebhook(
      new Request('https://example.com/webhooks/imessage', { method: 'POST', body: '{}' }),
    );

    expect(response.status).toBe(401);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('uses Chat SDK state to suppress exact outbound echoes', async () => {
    const fake = createFakeProvider();
    const adapter = createIMessageAdapter({ provider: fake.provider });
    const state = createMockState();
    const processMessage = vi.fn(
      async (...arguments_: Parameters<ChatInstance['processMessage']>) => {
        void arguments_;
      },
    );
    await adapter.initialize(createMockChatInstance({ state, overrides: { processMessage } }));
    const threadId = await adapter.openDM('+15551111111');
    await adapter.postMessage(threadId, 'Hello');

    fake.setEvents([
      messageReceivedEvent(
        fakeMessage({ providerMessageId: 'sent-1', direction: 'inbound', text: 'Hello' }),
      ),
    ]);
    await adapter.handleWebhook(
      new Request('https://example.com/webhooks/imessage', {
        method: 'POST',
        headers: { 'x-test-signature': 'valid' },
        body: '{}',
      }),
    );

    expect(processMessage).not.toHaveBeenCalled();
    expect(state.cache.get('imessage:sent:test-provider:default:sent-1')).toBe(true);
  });

  it('dispatches normalized reaction webhooks', async () => {
    const fake = createFakeProvider();
    const reaction: ProviderEvent = {
      id: 'reaction-event-1',
      type: 'reaction.added',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      conversationId: 'conversation-1',
      messageId: 'message-1',
      actor: { kind: 'phone', value: '+15551111111' },
      reaction: 'love',
      raw: { fixture: true },
    };
    fake.setEvents([reaction]);
    const processReaction = vi.fn();
    const adapter = createIMessageAdapter({ provider: fake.provider });
    await adapter.initialize(createMockChatInstance({ overrides: { processReaction } }));

    await adapter.handleWebhook(
      new Request('https://example.com/webhooks/imessage', {
        method: 'POST',
        headers: { 'x-test-signature': 'valid' },
        body: '{}',
      }),
    );

    expect(processReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        added: true,
        messageId: 'message-1',
        rawEmoji: 'love',
        user: expect.objectContaining({ userId: '+15551111111' }),
      }),
      undefined,
    );
  });

  it('suppresses exact reaction echoes through Chat SDK state', async () => {
    const fake = createFakeProvider();
    const state = createMockState();
    const processReaction = vi.fn();
    const adapter = createIMessageAdapter({ provider: fake.provider });
    await adapter.initialize(createMockChatInstance({ state, overrides: { processReaction } }));
    const threadId = await adapter.openDM('+15551111111');
    await adapter.addReaction(threadId, 'message-1', 'heart');
    fake.setEvents([
      {
        id: 'reaction-event-1',
        type: 'reaction.added',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        conversationId: 'conversation-1',
        messageId: 'message-1',
        actor: { kind: 'phone', value: '+15552222222' },
        reaction: 'love',
        raw: { fixture: true },
      },
    ]);

    await adapter.handleWebhook(
      new Request('https://example.com/webhooks/imessage', {
        method: 'POST',
        headers: { 'x-test-signature': 'valid' },
        body: '{}',
      }),
    );

    expect(processReaction).not.toHaveBeenCalled();
  });

  it('does not dispatch inbound messages with non-routable fallback conversations', async () => {
    const fake = createFakeProvider();
    const processMessage = vi.fn(
      async (...arguments_: Parameters<ChatInstance['processMessage']>) => {
        void arguments_;
      },
    );
    const adapter = createIMessageAdapter({ provider: fake.provider });
    await adapter.initialize(createMockChatInstance({ overrides: { processMessage } }));
    const message = fakeMessage({
      conversationId: createFallbackConversationId(
        'message-without-conversation',
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    });
    fake.setEvents([messageReceivedEvent(message)]);

    await adapter.handleWebhook(
      new Request('https://example.com/webhooks/imessage', {
        method: 'POST',
        headers: { 'x-test-signature': 'valid' },
        body: '{}',
      }),
    );

    expect(processMessage).not.toHaveBeenCalled();
  });

  it('rejects threads owned by another provider connection', async () => {
    const fake = createFakeProvider();
    const first = createIMessageAdapter({ connectionId: 'first', provider: fake.provider });
    const second = createIMessageAdapter({ connectionId: 'second', provider: fake.provider });
    const threadId = await first.openDM('+15551111111');

    await expect(second.postMessage(threadId, 'Hello')).rejects.toThrow(
      'Thread ID belongs to another provider connection',
    );
  });

  it('throws Chat SDK not-implemented errors for disabled normalized capabilities', async () => {
    const fake = createFakeProvider();
    const provider = {
      ...fake.provider,
      capabilities: {
        ...fake.provider.capabilities,
        messages: { ...fake.provider.capabilities.messages, edit: false, delete: false },
      },
    } as const;
    const adapter = createIMessageAdapter({ provider });
    const threadId = await adapter.openDM('+15551111111');

    await expect(adapter.editMessage(threadId, 'message-1', 'Edited')).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    await expect(adapter.deleteMessage(threadId, 'message-1')).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});
