import type {
  Adapter,
  AdapterPostableMessage,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  UserInfo,
  WebhookOptions,
} from 'chat';

import { ValidationError as AdapterValidationError } from '@chat-adapter/shared';
import { Message as ChatMessage, ConsoleLogger, NotImplementedError } from 'chat';

import type {
  AnyIMessageProvider,
  IMessageEvent,
  IMessageReaction,
  NonEmptyReadonlyArray,
  SendMessageInput,
} from 'imessage-sdk';
import {
  ValidationError as CoreValidationError,
  createIMessageClient,
  DEFAULT_CONNECTION_ID,
  isFallbackConversationId,
  WebhookVerificationError,
} from 'imessage-sdk';

import type {
  IMessageAdapterClient,
  IMessageAdapterMessage,
  IMessageAdapterOptions,
  IMessageThreadId,
} from './types.js';
import { attachmentsFromPostable } from './attachments.js';
import { IMessageFormatConverter } from './format.js';
import { addressFromUserId, attachmentToChat, authorFromAddress } from './messages.js';
import { toChatEmoji, toIMessageReaction } from './reactions.js';
import { decodeIMessageThreadId, encodeIMessageThreadId } from './thread-id.js';

const SENT_MESSAGE_TTL_MS = 24 * 60 * 60 * 1_000;
const MESSAGE_CACHE_LIMIT = 100;

export class IMessageAdapter<
  TProvider extends AnyIMessageProvider,
  TConnectionId extends string = typeof DEFAULT_CONNECTION_ID,
> implements Adapter<
  IMessageThreadId<TProvider['name'], TConnectionId>,
  IMessageAdapterMessage<TProvider, TConnectionId>
> {
  readonly name = 'imessage';
  readonly lockScope = 'thread' as const;
  readonly persistThreadHistory = true;
  readonly client: IMessageAdapterClient<TProvider, TConnectionId>;

  private chat: ChatInstance | null = null;
  private logger: Logger;
  private readonly configuredUserName: string | undefined;
  private readonly messagesByThread = new Map<
    string,
    ChatMessage<IMessageAdapterMessage<TProvider, TConnectionId>>[]
  >();
  private readonly activeTypingIndicators = new Map<string, string>();

  constructor(options: IMessageAdapterOptions<TProvider, TConnectionId>) {
    this.client = createIMessageClient({
      provider: options.provider,
      ...(options.connectionId === undefined ? {} : { connectionId: options.connectionId }),
    }) as IMessageAdapterClient<TProvider, TConnectionId>;
    this.configuredUserName = options.userName;
    this.logger = options.logger ?? new ConsoleLogger('info', 'imessage');
  }

  get userName(): string {
    return this.configuredUserName ?? this.chat?.getUserName() ?? 'imessage-bot';
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    if (this.configuredUserName === undefined) {
      this.logger = chat.getLogger('imessage');
    }
    this.logger.info('iMessage adapter initialized', {
      provider: this.client.provider,
      connectionId: this.client.connectionId,
    });
  }

  async disconnect(): Promise<void> {
    await Promise.all(
      [...this.activeTypingIndicators.keys()].map(
        async (threadId) => await this.stopTyping(threadId),
      ),
    );
    await this.client.close();
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const chat = this.chat;
    if (!chat) return new Response('Adapter is not initialized', { status: 503 });

    let events: readonly IMessageEvent<TProvider['name'], TConnectionId>[];
    try {
      events = await this.client.webhooks.handle(request);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return new Response('Invalid signature', { status: 401 });
      }
      if (error instanceof CoreValidationError) {
        return new Response('Invalid webhook', { status: 400 });
      }
      throw error;
    }

    for (const event of events) {
      await this.processEvent(event, chat, options);
    }

    return new Response('OK');
  }

  async postMessage(
    threadId: string,
    postable: AdapterPostableMessage,
  ): Promise<RawMessage<IMessageAdapterMessage<TProvider, TConnectionId>>> {
    const thread = this.decodeOwnedThreadId(threadId);
    try {
      const text = this.formatConverter.renderPostable(postable).trim();
      const attachments = await attachmentsFromPostable(postable);
      if (!text && attachments.length === 0) {
        throw new AdapterValidationError('imessage', 'Message text or an attachment is required');
      }

      const input: SendMessageInput =
        attachments.length > 0
          ? {
              conversationId: thread.conversationId,
              ...(text ? { text } : {}),
              attachments: asNonEmpty(attachments),
            }
          : { conversationId: thread.conversationId, text };

      const sent = await this.client.messages.send(input);
      const resultingThreadId = this.threadId(sent.conversationId);
      await this.rememberSentMessage(sent.id);
      this.cacheMessage(this.toChatMessage(sent, resultingThreadId, true));

      return { id: sent.id, raw: sent, threadId: resultingThreadId };
    } finally {
      await this.stopTyping(threadId);
    }
  }

  async editMessage(
    threadId: string,
    messageId: string,
    postable: AdapterPostableMessage,
  ): Promise<RawMessage<IMessageAdapterMessage<TProvider, TConnectionId>>> {
    if (!this.client.capabilities.messages.edit) {
      throw new NotImplementedError(
        `${this.client.provider} does not support editing messages`,
        'editMessage',
      );
    }

    const thread = this.decodeOwnedThreadId(threadId);
    const text = this.formatConverter.renderPostable(postable).trim();
    const attachments = await attachmentsFromPostable(postable);
    if (!text || attachments.length > 0) {
      throw new AdapterValidationError(
        'imessage',
        'Message edits require text and cannot replace attachments',
      );
    }

    const edited = await this.client.messages.edit(
      { conversationId: thread.conversationId, messageId },
      { text },
    );
    const resultingThreadId = this.threadId(edited.conversationId);
    this.cacheMessage(this.toChatMessage(edited, resultingThreadId, true));
    return { id: edited.id, raw: edited, threadId: resultingThreadId };
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    if (!this.client.capabilities.messages.delete) {
      throw new NotImplementedError(
        `${this.client.provider} does not support deleting messages`,
        'deleteMessage',
      );
    }
    const thread = this.decodeOwnedThreadId(threadId);
    await this.client.messages.delete({ conversationId: thread.conversationId, messageId });
    this.deleteCachedMessage(threadId, messageId);
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    if (!this.client.capabilities.interactions.reactions) {
      throw new NotImplementedError(
        `${this.client.provider} does not support reactions`,
        'addReaction',
      );
    }
    const thread = this.decodeOwnedThreadId(threadId);
    const reaction = toIMessageReaction(emoji);
    await this.client.reactions.add({
      conversationId: thread.conversationId,
      messageId,
      reaction,
    });
    await this.rememberReaction('reaction.added', thread.conversationId, messageId, reaction);
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string,
  ): Promise<void> {
    if (!this.client.capabilities.interactions.reactions) {
      throw new NotImplementedError(
        `${this.client.provider} does not support reactions`,
        'removeReaction',
      );
    }
    const thread = this.decodeOwnedThreadId(threadId);
    const reaction = toIMessageReaction(emoji);
    await this.client.reactions.remove({
      conversationId: thread.conversationId,
      messageId,
      reaction,
    });
    await this.rememberReaction('reaction.removed', thread.conversationId, messageId, reaction);
  }

  async startTyping(threadId: string): Promise<void> {
    if (!this.client.capabilities.interactions.typingStart) {
      throw new NotImplementedError(
        `${this.client.provider} does not support typing indicators`,
        'startTyping',
      );
    }
    const thread = this.decodeOwnedThreadId(threadId);
    await this.client.typing.start(thread.conversationId);
    this.activeTypingIndicators.set(threadId, thread.conversationId);
  }

  async markRead(threadId: string): Promise<void> {
    if (!this.client.capabilities.conversations.markRead) {
      throw new NotImplementedError(
        `${this.client.provider} does not support read receipts`,
        'markRead',
      );
    }
    const thread = this.decodeOwnedThreadId(threadId);
    await this.client.conversations.markRead(thread.conversationId);
  }

  async openDM(userId: string): Promise<string> {
    if (!this.client.capabilities.conversations.direct) {
      throw new NotImplementedError(
        `${this.client.provider} does not support direct conversations`,
        'openDM',
      );
    }
    const conversation = await this.client.conversations.open({
      participants: [addressFromUserId(userId)],
    });
    return this.threadId(conversation.id);
  }

  isDM(threadId: string): boolean {
    try {
      this.decodeOwnedThreadId(threadId);
      return true;
    } catch {
      return false;
    }
  }

  async getUser(userId: string): Promise<UserInfo | null> {
    const address = addressFromUserId(userId);
    return {
      userId: address.value,
      userName: address.value,
      fullName: address.value,
      isBot: false,
      ...(address.kind === 'email' ? { email: address.value } : {}),
    };
  }

  async fetchMessage(
    threadId: string,
    messageId: string,
  ): Promise<ChatMessage<IMessageAdapterMessage<TProvider, TConnectionId>> | null> {
    const cached = this.findCachedMessage(threadId, messageId);
    if (cached) return cached;
    if (!this.client.capabilities.messages.get) return null;

    const thread = this.decodeOwnedThreadId(threadId);
    const message = await this.client.messages.get({
      conversationId: thread.conversationId,
      messageId,
    });
    if (!message) return null;
    const parsed = this.toChatMessage(message, this.threadId(message.conversationId), false);
    this.cacheMessage(parsed);
    return parsed;
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {},
  ): Promise<FetchResult<IMessageAdapterMessage<TProvider, TConnectionId>>> {
    this.decodeOwnedThreadId(threadId);
    const messages = [...(this.messagesByThread.get(threadId) ?? [])].sort(
      (left, right) => left.metadata.dateSent.getTime() - right.metadata.dateSent.getTime(),
    );
    return paginate(messages, options);
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const thread = this.decodeOwnedThreadId(threadId);
    if (!this.client.capabilities.conversations.get) return this.basicThreadInfo(threadId, thread);

    const conversation = await this.client.conversations.get(thread.conversationId);
    if (!conversation) return this.basicThreadInfo(threadId, thread);
    return {
      id: threadId,
      channelId: threadId,
      channelName: conversation.participants.map((participant) => participant.value).join(', '),
      isDM: true,
      metadata: {
        provider: thread.provider,
        connectionId: thread.connectionId,
        conversationId: thread.conversationId,
        participants: conversation.participants,
      },
    };
  }

  channelIdFromThreadId(threadId: string): string {
    this.decodeOwnedThreadId(threadId);
    return threadId;
  }

  encodeThreadId(thread: IMessageThreadId<TProvider['name'], TConnectionId>): string {
    this.assertOwnedThread(thread);
    return encodeIMessageThreadId(thread);
  }

  decodeThreadId(threadId: string): IMessageThreadId<TProvider['name'], TConnectionId> {
    return this.decodeOwnedThreadId(threadId);
  }

  parseMessage(
    raw: IMessageAdapterMessage<TProvider, TConnectionId>,
  ): ChatMessage<IMessageAdapterMessage<TProvider, TConnectionId>> {
    return this.toChatMessage(raw, this.threadId(raw.conversationId), false);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private readonly formatConverter = new IMessageFormatConverter();

  private async processEvent(
    event: IMessageEvent<TProvider['name'], TConnectionId>,
    chat: ChatInstance,
    options?: WebhookOptions,
  ): Promise<void> {
    switch (event.type) {
      case 'message.received': {
        const sentByThisAdapter = await this.wasSentByThisAdapter(event.message.id);
        if (sentByThisAdapter || event.message.direction !== 'inbound') return;
        if (isFallbackConversationId(event.message.conversationId)) {
          this.logger.warn('Ignored inbound message without a routable conversation ID', {
            messageId: event.message.id,
            provider: this.client.provider,
            connectionId: this.client.connectionId,
          });
          return;
        }
        const threadId = this.threadId(event.message.conversationId);
        const message = this.toChatMessage(event.message, threadId, false);
        this.cacheMessage(message);
        void chat.processMessage(this, threadId, message, options);
        return;
      }
      case 'message.sent':
      case 'message.delivered':
      case 'message.read':
      case 'message.failed':
      case 'message.edited':
      case 'message.deleted':
      case 'typing.started':
      case 'typing.stopped':
        return;
      case 'reaction.added':
      case 'reaction.removed': {
        if (
          await this.wasReactionSent(
            event.type,
            event.conversationId,
            event.messageId,
            event.reaction,
          )
        ) {
          return;
        }
        const threadId = this.threadId(event.conversationId);
        chat.processReaction(
          {
            adapter: this,
            threadId,
            messageId: event.messageId,
            emoji: toChatEmoji(event.reaction),
            rawEmoji: event.reaction,
            added: event.type === 'reaction.added',
            user: authorFromAddress(event.actor, false),
            raw: event.raw,
          },
          options,
        );
      }
    }
  }

  private toChatMessage(
    raw: IMessageAdapterMessage<TProvider, TConnectionId>,
    threadId: string,
    isMe: boolean,
  ): ChatMessage<IMessageAdapterMessage<TProvider, TConnectionId>> {
    return new ChatMessage({
      id: raw.id,
      threadId,
      text: raw.text,
      formatted: this.formatConverter.toAst(raw.text),
      raw,
      author: authorFromAddress(raw.sender, isMe),
      metadata: {
        dateSent: raw.sentAt ?? raw.createdAt,
        edited: false,
      },
      attachments: raw.attachments.map(attachmentToChat),
    });
  }

  private threadId(conversationId: string): string {
    return this.encodeThreadId({
      version: 1,
      provider: this.client.provider,
      connectionId: this.client.connectionId,
      conversationId,
    });
  }

  private decodeOwnedThreadId(
    threadId: string,
  ): IMessageThreadId<TProvider['name'], TConnectionId> {
    const decoded = decodeIMessageThreadId(threadId);
    this.assertOwnedThread(decoded);
    return decoded as IMessageThreadId<TProvider['name'], TConnectionId>;
  }

  private assertOwnedThread(thread: IMessageThreadId<string, string>): void {
    if (
      thread.provider !== this.client.provider ||
      thread.connectionId !== this.client.connectionId
    ) {
      throw new AdapterValidationError(
        'imessage',
        'Thread ID belongs to another provider connection',
      );
    }
  }

  private basicThreadInfo(
    threadId: string,
    thread: IMessageThreadId<TProvider['name'], TConnectionId>,
  ): ThreadInfo {
    return {
      id: threadId,
      channelId: threadId,
      isDM: true,
      metadata: {
        provider: thread.provider,
        connectionId: thread.connectionId,
        conversationId: thread.conversationId,
      },
    };
  }

  private sentMessageKey(messageId: string): string {
    return `imessage:sent:${this.client.provider}:${this.client.connectionId}:${messageId}`;
  }

  private reactionKey(
    type: 'reaction.added' | 'reaction.removed',
    conversationId: string,
    messageId: string,
    reaction: IMessageReaction,
  ): string {
    return `imessage:reaction:${this.client.provider}:${this.client.connectionId}:${type}:${conversationId}:${messageId}:${reaction}`;
  }

  private async rememberSentMessage(messageId: string): Promise<void> {
    if (!this.chat) return;
    await this.chat.getState().set(this.sentMessageKey(messageId), true, SENT_MESSAGE_TTL_MS);
  }

  private async wasSentByThisAdapter(messageId: string): Promise<boolean> {
    if (!this.chat) return false;
    return (await this.chat.getState().get<boolean>(this.sentMessageKey(messageId))) === true;
  }

  private async rememberReaction(
    type: 'reaction.added' | 'reaction.removed',
    conversationId: string,
    messageId: string,
    reaction: IMessageReaction,
  ): Promise<void> {
    if (!this.chat) return;
    await this.chat
      .getState()
      .set(this.reactionKey(type, conversationId, messageId, reaction), true, SENT_MESSAGE_TTL_MS);
  }

  private async wasReactionSent(
    type: 'reaction.added' | 'reaction.removed',
    conversationId: string,
    messageId: string,
    reaction: IMessageReaction,
  ): Promise<boolean> {
    if (!this.chat) return false;
    const state = this.chat.getState();
    const key = this.reactionKey(type, conversationId, messageId, reaction);
    if ((await state.get<boolean>(key)) !== true) return false;
    await state.delete(key);
    return true;
  }

  private cacheMessage(
    message: ChatMessage<IMessageAdapterMessage<TProvider, TConnectionId>>,
  ): void {
    const existing = this.messagesByThread.get(message.threadId) ?? [];
    const withoutCurrent = existing.filter((item) => item.id !== message.id);
    this.messagesByThread.set(
      message.threadId,
      [...withoutCurrent, message].slice(-MESSAGE_CACHE_LIMIT),
    );
  }

  private findCachedMessage(
    threadId: string,
    messageId: string,
  ): ChatMessage<IMessageAdapterMessage<TProvider, TConnectionId>> | undefined {
    return this.messagesByThread.get(threadId)?.find((message) => message.id === messageId);
  }

  private deleteCachedMessage(threadId: string, messageId: string): void {
    const messages = this.messagesByThread.get(threadId);
    if (!messages) return;
    this.messagesByThread.set(
      threadId,
      messages.filter((message) => message.id !== messageId),
    );
  }

  private async stopTyping(threadId: string): Promise<void> {
    const conversationId = this.activeTypingIndicators.get(threadId);
    if (conversationId === undefined) return;

    this.activeTypingIndicators.delete(threadId);

    if (!this.client.capabilities.interactions.typingStop) return;

    try {
      await this.client.typing.stop(conversationId);
    } catch (error) {
      this.logger.warn('Failed to stop iMessage typing indicator', {
        threadId,
        provider: this.client.provider,
        connectionId: this.client.connectionId,
        error,
      });
    }
  }
}

function asNonEmpty<T>(values: readonly T[]): NonEmptyReadonlyArray<T> {
  const [first, ...rest] = values;
  if (first === undefined) throw new TypeError('Expected at least one value');
  return [first, ...rest];
}

function paginate<TRawMessage>(
  messages: ChatMessage<TRawMessage>[],
  options: FetchOptions,
): FetchResult<TRawMessage> {
  const limit = Math.max(1, options.limit ?? 50);
  const cursor = parseCursor(options.cursor, messages.length);
  if (options.direction === 'forward') {
    const start = cursor ?? 0;
    const page = messages.slice(start, start + limit);
    const next = start + page.length;
    return {
      messages: page,
      ...(next < messages.length ? { nextCursor: String(next) } : {}),
    };
  }

  const end = cursor ?? messages.length;
  const start = Math.max(0, end - limit);
  return {
    messages: messages.slice(start, end),
    ...(start > 0 ? { nextCursor: String(start) } : {}),
  };
}

function parseCursor(cursor: string | undefined, maximum: number): number | undefined {
  if (cursor === undefined) return undefined;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new AdapterValidationError('imessage', 'Invalid message history cursor');
  }
  return value;
}
