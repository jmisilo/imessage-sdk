import { vi } from 'vitest';

import type {
  IMessageCapabilities,
  ProviderEvent,
  ProviderMessage,
  ProviderSentMessage,
  SendMessageInput,
} from 'imessage-sdk';
import { defineProvider } from 'imessage-sdk';

const FULL_CAPABILITIES = {
  messages: {
    text: true,
    attachments: true,
    replies: true,
    get: true,
    edit: true,
    delete: true,
  },
  conversations: {
    direct: true,
    groups: false,
    get: true,
    markRead: true,
  },
  interactions: {
    reactions: true,
    typingStart: true,
    typingStop: true,
    readReceipts: true,
  },
  events: {
    webhooks: true,
    stream: false,
  },
} as const satisfies IMessageCapabilities;

export function createFakeProvider() {
  let events: readonly ProviderEvent[] = [];
  let sentCount = 0;

  const send = vi.fn(async (input: SendMessageInput): Promise<ProviderSentMessage> => {
    sentCount += 1;
    return {
      ...fakeMessage({
        providerMessageId: `sent-${sentCount}`,
        conversationId: 'conversation-1',
        text: input.text ?? '',
        attachments: (input.attachments ?? []).map((attachment, index) => ({
          kind: attachment.kind,
          id: `attachment-${index}`,
          ...(attachment.source.type === 'url' ? { url: attachment.source.url } : {}),
          ...(attachment.filename === undefined ? {} : { filename: attachment.filename }),
          ...(attachment.contentType === undefined ? {} : { contentType: attachment.contentType }),
          raw: attachment,
        })),
      }),
      direction: 'outbound',
    };
  });

  const get = vi.fn(async ({ messageId }): Promise<ProviderMessage | null> =>
    messageId === 'missing' ? null : fakeMessage({ providerMessageId: messageId }),
  );
  const edit = vi.fn(async ({ messageId }, input): Promise<ProviderMessage> =>
    fakeMessage({ providerMessageId: messageId, direction: 'outbound', text: input.text }),
  );
  const deleteMessage = vi.fn(async () => undefined);
  const open = vi.fn(async (input) => ({
    providerConversationId: 'conversation-1',
    participants: input.participants,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    raw: input,
  }));
  const getConversation = vi.fn(async (conversationId: string) => ({
    providerConversationId: conversationId,
    participants: [{ kind: 'phone' as const, value: '+15550000000' }],
    raw: { conversationId },
  }));
  const markRead = vi.fn(async () => undefined);
  const addReaction = vi.fn(async () => undefined);
  const removeReaction = vi.fn(async () => undefined);
  const startTyping = vi.fn(async () => undefined);
  const stopTyping = vi.fn(async () => undefined);

  const provider = defineProvider({
    name: 'test-provider',
    capabilities: FULL_CAPABILITIES,
    messages: { send, get, edit, delete: deleteMessage },
    conversations: { open, get: getConversation, markRead },
    reactions: { add: addReaction, remove: removeReaction },
    typing: { start: startTyping, stop: stopTyping },
    webhooks: {
      verify: async (request: Request) => request.headers.get('x-test-signature') === 'valid',
      parse: async () => events,
    },
  });

  return {
    provider,
    setEvents(next: readonly ProviderEvent[]) {
      events = next;
    },
    spies: {
      send,
      get,
      edit,
      deleteMessage,
      open,
      getConversation,
      markRead,
      addReaction,
      removeReaction,
      startTyping,
      stopTyping,
    },
  };
}

export function fakeMessage(overrides: Partial<ProviderMessage> = {}): ProviderMessage {
  return {
    providerMessageId: 'message-1',
    conversationId: 'conversation-1',
    direction: 'inbound',
    sender: { kind: 'phone', value: '+15551111111' },
    recipients: [{ kind: 'phone', value: '+15552222222' }],
    text: 'Hello',
    attachments: [],
    service: 'imessage',
    status: 'delivered',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    raw: { fixture: true },
    ...overrides,
  };
}

export function messageReceivedEvent(message: ProviderMessage = fakeMessage()): ProviderEvent {
  return {
    id: `event-${message.providerMessageId}`,
    providerEventId: `provider-event-${message.providerMessageId}`,
    type: 'message.received',
    timestamp: message.createdAt,
    message,
    raw: { event: true },
  };
}
