import type {
  AdvancedIMessage,
  Chat,
  MessageContent,
  MessageEvent,
  Message as PhotonMessage,
  RetryOptions,
  SettableMessageReaction,
  TypedEventStream,
} from '@photon-ai/advanced-imessage';
import type { TokenData } from '@spectrum-ts/core';

import {
  createClient,
  AuthenticationError as PhotonAuthenticationError,
  ConnectionError as PhotonConnectionError,
  IMessageError as PhotonError,
  NotFoundError as PhotonNotFoundError,
  RateLimitError as PhotonRateLimitError,
  ValidationError as PhotonValidationError,
} from '@photon-ai/advanced-imessage';
import { cloud, SpectrumCloudError } from '@spectrum-ts/core';
import { z } from 'zod';

import type {
  IMessageAddress,
  IMessageAttachment,
  IMessageAttachmentInput,
  IMessageProvider,
  IMessageReaction,
  IMessageService,
  IMessageStatus,
  MessageLocator,
  ProviderConversation,
  ProviderConversations,
  ProviderEvent,
  ProviderEvents,
  ProviderMessage,
  ProviderMessages,
  ProviderReactions,
  ProviderSentMessage,
  ProviderTyping,
  ProviderWebhooks,
  SubscribeOptions,
} from 'imessage-sdk';
import {
  AmbiguousDeliveryError,
  AuthenticationError,
  ConflictError,
  defineProvider,
  IMessageSDKError,
  NotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  ValidationError,
} from 'imessage-sdk';

const SHARED_ADDRESS = 'imessage.spectrum.photon.codes:443';
const SHARED_PHONE = 'shared';
const TOKEN_EXPIRY_BUFFER_MS = 30_000;
const TOKEN_RENEWAL_RATIO = 0.8;
const TOKEN_RETRY_MS = 30_000;
const WEBHOOK_TOLERANCE_SECONDS = 300;

export const PHOTON_CAPABILITIES = {
  messages: {
    text: true,
    attachments: true,
    replies: true,
    get: true,
    edit: false,
    delete: false,
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
} as const;

export interface PhotonOptions {
  readonly projectId?: string;
  readonly projectSecret?: string;
  /** Dedicated line to bind to. Optional when the project has exactly one line. */
  readonly phone?: string;
  readonly webhookSecret?: string;
  readonly timeout?: number;
  readonly retry?: boolean | RetryOptions;
}

export interface PhotonLine {
  readonly phone: string;
  readonly instanceId: string;
  readonly type: 'dedicated' | 'shared';
}

export interface PhotonConnection {
  getLine(): Promise<PhotonLine>;
}

export interface PhotonMessages extends Omit<ProviderMessages, 'edit' | 'delete'> {
  get(message: MessageLocator): Promise<ProviderMessage | null>;
}

export interface PhotonConversations extends ProviderConversations {
  get(conversationId: string): Promise<ProviderConversation | null>;
  markRead(conversationId: string): Promise<void>;
}

export interface PhotonProvider extends IMessageProvider<'photon', typeof PHOTON_CAPABILITIES> {
  readonly messages: PhotonMessages;
  readonly conversations: PhotonConversations;
  readonly reactions: ProviderReactions;
  readonly typing: Required<ProviderTyping>;
  readonly webhooks: ProviderWebhooks;
  readonly events: ProviderEvents;
  readonly connection: PhotonConnection;
}

interface CloudConnection {
  readonly client: AdvancedIMessage;
  readonly line: PhotonLine;
  close(): Promise<void>;
}

const WebhookAttachmentSchema = z.object({
  type: z.literal('attachment'),
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().finite().nonnegative().optional(),
});

const WebhookMessageSchema = z.object({
  id: z.string().min(1),
  direction: z.literal('inbound'),
  timestamp: z.iso.datetime(),
  sender: z.object({ id: z.string().min(1) }),
  space: z.object({
    id: z.string().min(1),
    phone: z.string().min(1).optional(),
  }),
  content: z.union([
    z.object({ type: z.literal('text'), text: z.string() }),
    WebhookAttachmentSchema,
    z.object({
      type: z.literal('reaction'),
      emoji: z.string().min(1),
      target: z.object({ id: z.string().min(1) }),
    }),
    z.object({
      type: z.literal('group'),
      items: z.array(
        z.object({
          content: WebhookAttachmentSchema,
        }),
      ),
    }),
  ]),
});

const WebhookPayloadSchema = z.object({
  event: z.literal('messages'),
  message: WebhookMessageSchema,
  space: z.object({
    id: z.string().min(1),
    phone: z.string().min(1).optional(),
  }),
});

function address(value: string): IMessageAddress {
  return { kind: value.includes('@') ? 'email' : 'phone', value };
}

function mapService(value: string): IMessageService {
  switch (value) {
    case 'iMessage':
      return 'imessage';
    case 'SMS':
      return 'sms';
    case 'RCS':
      return 'rcs';
    default:
      return 'unknown';
  }
}

function mapStatus(message: PhotonMessage): IMessageStatus {
  if (message.sendErrorCode !== 0 || message.isCorrupt) return 'failed';
  if (message.dateRead !== undefined) return 'read';
  if (message.dateDelivered !== undefined || message.isDelivered) {
    return 'delivered';
  }
  if (message.isSent) return 'sent';
  return 'pending';
}

function providerStatus(message: PhotonMessage): string {
  if (message.dateRetracted !== undefined) return 'unsent';
  if (message.sendErrorCode !== 0) return `error:${message.sendErrorCode}`;
  return mapStatus(message);
}

function attachmentKind(mimeType: string): IMessageAttachment['kind'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

function mapAttachment(
  attachment: PhotonMessage['content']['attachments'][number],
): IMessageAttachment {
  return {
    kind: attachmentKind(attachment.mimeType),
    id: attachment.guid,
    filename: attachment.fileName,
    contentType: attachment.mimeType,
    size: attachment.totalBytes,
    raw: attachment,
  };
}

function mapConversation(chat: Chat): ProviderConversation {
  return {
    providerConversationId: chat.guid,
    participants: chat.participants.map((participant) => address(participant.address)),
    raw: chat,
  };
}

function replyReference(
  message: PhotonMessage,
): { readonly messageId: string; readonly partIndex?: number } | undefined {
  const messageId = message.replyTargetGuid ?? message.threadOriginatorGuid;
  if (messageId === undefined) return undefined;
  const rawPart = message.threadOriginatorPart;
  const partIndex = rawPart === undefined ? undefined : Number(rawPart);
  return {
    messageId,
    ...(partIndex !== undefined && Number.isInteger(partIndex) ? { partIndex } : {}),
  };
}

function messageText(content: MessageContent): string {
  return content.text ?? '';
}

async function attachmentBytes(attachment: IMessageAttachmentInput): Promise<Uint8Array> {
  switch (attachment.source.type) {
    case 'bytes':
      return attachment.source.data;
    case 'blob':
      return new Uint8Array(await attachment.source.data.arrayBuffer());
    case 'url': {
      let response: Response;
      try {
        response = await fetch(attachment.source.url);
      } catch (cause) {
        throw new ProviderUnavailableError(
          `Could not download Photon attachment ${attachment.source.url}.`,
          {
            provider: 'photon',
            code: 'attachment_download_failed',
            retryable: true,
            raw: cause,
          },
        );
      }
      if (!response.ok) {
        throw new ProviderUnavailableError(
          `Attachment download failed with HTTP ${response.status}.`,
          {
            provider: 'photon',
            code: 'attachment_download_failed',
            statusCode: response.status,
            retryable: response.status >= 500,
          },
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    }
  }
}

function attachmentFilename(attachment: IMessageAttachmentInput): string {
  if (attachment.filename !== undefined && attachment.filename.length > 0) {
    return attachment.filename;
  }
  if (attachment.source.type === 'url') {
    try {
      const name = new URL(attachment.source.url).pathname.split('/').at(-1);
      if (name !== undefined && name.length > 0) return name;
    } catch {
      // The download produces the validation error with provider context.
    }
  }
  const extension =
    attachment.kind === 'image' ? 'jpg' : attachment.kind === 'video' ? 'mp4' : 'bin';
  return `attachment.${extension}`;
}

function mapReaction(reaction: IMessageReaction): SettableMessageReaction {
  return { kind: reaction };
}

function normalizeReaction(
  reaction: PhotonMessage['reaction'] | { readonly kind: string; readonly emoji?: string },
): IMessageReaction | undefined {
  switch (reaction?.kind) {
    case 'love':
    case 'like':
    case 'dislike':
    case 'laugh':
    case 'emphasize':
    case 'question':
      return reaction.kind;
    case 'emoji':
      return normalizeWebhookReaction(reaction.emoji ?? '');
    default:
      return undefined;
  }
}

function normalizeWebhookReaction(value: string): IMessageReaction | undefined {
  switch (value.toLowerCase()) {
    case 'love':
    case '❤️':
    case '❤':
      return 'love';
    case 'like':
    case '👍':
      return 'like';
    case 'dislike':
    case '👎':
      return 'dislike';
    case 'laugh':
    case '😂':
      return 'laugh';
    case 'emphasize':
    case '‼️':
    case '!!':
      return 'emphasize';
    case 'question':
    case '❓':
    case '?':
      return 'question';
    default:
      return undefined;
  }
}

function errorOptions(error: unknown) {
  const photon = error instanceof PhotonError ? error : undefined;
  return {
    provider: 'photon',
    ...(photon?.code === undefined ? {} : { code: photon.code }),
    ...(photon?.retryable === undefined ? {} : { retryable: photon.retryable }),
    raw: error,
  } as const;
}

function mapError(error: unknown, operation: string): never {
  if (error instanceof IMessageSDKError) throw error;
  if (
    (error instanceof PhotonError && error.code === 'duplicateMessage') ||
    (error instanceof Error &&
      /operation already processed with this client message id/i.test(error.message))
  ) {
    throw new ConflictError(
      'Photon already processed this idempotency key; the duplicate operation was not sent again.',
      {
        ...errorOptions(error),
        code: 'duplicate_message',
      },
    );
  }
  if (error instanceof SpectrumCloudError) {
    const options = {
      provider: 'photon',
      code: error.code,
      statusCode: error.status,
      raw: error,
    } as const;
    if (error.status === 401 || error.status === 403) {
      throw new AuthenticationError(error.message, options);
    }
    if (error.status === 429) {
      throw new RateLimitError(error.message, {
        ...options,
        retryable: true,
      });
    }
    if (error.status >= 500) {
      throw new ProviderUnavailableError(error.message, {
        ...options,
        retryable: true,
      });
    }
    throw new IMessageSDKError(error.message, options);
  }
  if (error instanceof PhotonAuthenticationError) {
    if (
      error.code === 'unauthorized' &&
      /target not allowed for this project/i.test(error.message)
    ) {
      throw new AuthenticationError(
        'Photon rejected this recipient because the target is not allowed for the Spectrum project. Use a permitted or opted-in project user; initiating a conversation with a new contact requires a Photon plan that supports cold outreach.',
        {
          ...errorOptions(error),
          code: 'photon_target_not_allowed',
        },
      );
    }
    throw new AuthenticationError(error.message, errorOptions(error));
  }
  if (error instanceof PhotonNotFoundError) {
    throw new NotFoundError(error.message, errorOptions(error));
  }
  if (error instanceof PhotonRateLimitError) {
    throw new RateLimitError(error.message, errorOptions(error));
  }
  if (error instanceof PhotonValidationError) {
    throw new ValidationError(error.message, errorOptions(error));
  }
  if (error instanceof PhotonConnectionError) {
    if (operation === 'messages.send') {
      throw new AmbiguousDeliveryError(
        'The Photon send result is unknown; retry only with the same idempotency key.',
        { ...errorOptions(error), code: 'ambiguous_delivery', retryable: true },
      );
    }
    throw new ProviderUnavailableError(error.message, {
      ...errorOptions(error),
      retryable: true,
    });
  }
  const message = error instanceof Error ? error.message : `Photon ${operation} failed.`;
  if (/unknown server error occurred/i.test(message)) {
    throw new ProviderUnavailableError(message, {
      provider: 'photon',
      code: 'photon_server_error',
      retryable: true,
      raw: error,
    });
  }
  throw new IMessageSDKError(message, {
    provider: 'photon',
    code: 'photon_error',
    raw: error,
  });
}

async function createCloudConnection(options: PhotonOptions): Promise<CloudConnection> {
  const projectId = options.projectId;
  const projectSecret = options.projectSecret;
  if (
    projectId === undefined ||
    projectId.length === 0 ||
    projectSecret === undefined ||
    projectSecret.length === 0
  ) {
    throw new AuthenticationError(
      'Photon project credentials are required. Pass projectId and projectSecret or set PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET.',
      { provider: 'photon', code: 'missing_project_credentials' },
    );
  }
  let tokenData = await cloud.issueImessageTokens(projectId, projectSecret);
  let expiresAt = Date.now() + tokenData.expiresIn * 1_000;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const selectLine = (data: TokenData): PhotonLine => {
    if (data.type === 'shared') {
      return { phone: SHARED_PHONE, instanceId: 'shared', type: 'shared' };
    }
    const lines = Object.entries(data.numbers).flatMap(([instanceId, phone]) =>
      phone === null ? [] : [{ phone, instanceId, type: 'dedicated' as const }],
    );
    if (options.phone !== undefined) {
      const selected = lines.find((line) => line.phone === options.phone);
      if (selected === undefined) {
        throw new ValidationError(
          `Photon phone ${options.phone} is not available to this Spectrum project.`,
          {
            provider: 'photon',
            code: 'photon_phone_not_found',
            raw: { availablePhones: lines.map((line) => line.phone) },
          },
        );
      }
      return selected;
    }
    if (lines.length !== 1 || lines[0] === undefined) {
      throw new ValidationError(
        'Photon phone is required when the Spectrum project does not have exactly one dedicated line.',
        {
          provider: 'photon',
          code: 'photon_phone_required',
          raw: { availablePhones: lines.map((line) => line.phone) },
        },
      );
    }
    return lines[0];
  };

  const line = selectLine(tokenData);

  function retryRefresh(): void {
    void refresh().catch(() => {
      if (!closed) {
        renewalTimer = setTimeout(retryRefresh, TOKEN_RETRY_MS);
        renewalTimer.unref?.();
      }
    });
  }

  const scheduleRenewal = (): void => {
    if (closed) return;
    if (renewalTimer !== undefined) clearTimeout(renewalTimer);
    const delay = Math.max(tokenData.expiresIn * 1_000 * TOKEN_RENEWAL_RATIO, 5_000);
    renewalTimer = setTimeout(retryRefresh, delay);
    renewalTimer.unref?.();
  };

  let refreshPromise: Promise<void> | undefined;
  const refresh = (): Promise<void> => {
    if (refreshPromise !== undefined) return refreshPromise;
    refreshPromise = cloud
      .issueImessageTokens(projectId, projectSecret)
      .then((next) => {
        const nextLine = selectLine(next);
        if (nextLine.instanceId !== line.instanceId) {
          throw new ValidationError('The selected Photon line changed during token renewal.', {
            provider: 'photon',
            code: 'photon_line_changed',
          });
        }
        tokenData = next;
        expiresAt = Date.now() + next.expiresIn * 1_000;
        scheduleRenewal();
      })
      .finally(() => {
        refreshPromise = undefined;
      });
    return refreshPromise;
  };

  const getToken = async (): Promise<string> => {
    if (Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS) await refresh();
    if (tokenData.type === 'shared') return tokenData.token;
    const token = tokenData.auth[line.instanceId];
    if (token === undefined) {
      throw new AuthenticationError('Photon did not issue a token for the selected line.', {
        provider: 'photon',
        code: 'photon_line_token_missing',
      });
    }
    return token;
  };

  const client = createClient({
    address: line.type === 'shared' ? SHARED_ADDRESS : `${line.instanceId}.imsg.photon.codes:443`,
    token: getToken,
    tls: true,
    retry: options.retry ?? true,
    autoIdempotency: true,
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  });
  scheduleRenewal();

  return {
    client,
    line,
    async close() {
      if (closed) return;
      closed = true;
      if (renewalTimer !== undefined) clearTimeout(renewalTimer);
      await client.close();
    },
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const result = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function webhookAttachments(
  content: z.infer<typeof WebhookMessageSchema>['content'],
): IMessageAttachment[] {
  const values =
    content.type === 'attachment'
      ? [content]
      : content.type === 'group'
        ? content.items.map((item) => item.content)
        : [];
  return values.map((item) => ({
    kind: attachmentKind(item.mimeType),
    id: item.id,
    filename: item.name,
    contentType: item.mimeType,
    ...(item.size === undefined ? {} : { size: item.size }),
    raw: item,
  }));
}

/** Creates a Photon provider backed by a Spectrum Cloud project. */
export function photon(options: PhotonOptions = {}): PhotonProvider {
  const projectId = options.projectId ?? process.env['PHOTON_PROJECT_ID'];
  const projectSecret = options.projectSecret ?? process.env['PHOTON_PROJECT_SECRET'];
  const phone = options.phone ?? process.env['PHOTON_PHONE_NUMBER'];
  const webhookSecret = options.webhookSecret ?? process.env['PHOTON_WEBHOOK_SECRET'];
  const config: PhotonOptions = {
    ...options,
    ...(projectId === undefined ? {} : { projectId }),
    ...(projectSecret === undefined ? {} : { projectSecret }),
    ...(phone === undefined ? {} : { phone }),
    ...(webhookSecret === undefined ? {} : { webhookSecret }),
  };
  let connectionPromise: Promise<CloudConnection> | undefined;
  const chatCache = new Map<string, Chat>();
  const activeStreams = new Set<TypedEventStream<unknown>>();

  const connection = (): Promise<CloudConnection> => {
    connectionPromise ??= createCloudConnection(config);
    return connectionPromise;
  };

  const run = async <T>(
    operation: string,
    fn: (value: CloudConnection) => Promise<T>,
  ): Promise<T> => {
    try {
      return await fn(await connection());
    } catch (error) {
      return mapError(error, operation);
    }
  };

  const getChat = async (client: AdvancedIMessage, id: string): Promise<Chat> => {
    const cached = chatCache.get(id);
    if (cached !== undefined) return cached;
    const chat = await client.chats.get(id);
    chatCache.set(id, chat);
    return chat;
  };

  const mapMessage = async (
    client: AdvancedIMessage,
    message: PhotonMessage,
    fallbackConversationId?: string,
  ): Promise<ProviderMessage> => {
    const conversationId = fallbackConversationId ?? message.chatGuids[0] ?? 'unknown';
    let chat: Chat | undefined;
    try {
      chat = await getChat(client, conversationId);
    } catch {
      chat = undefined;
    }
    const line = (await connection()).line;
    const direction = message.isFromMe ? 'outbound' : 'inbound';
    const ownAddress = address(line.phone);
    const sender =
      direction === 'outbound'
        ? ownAddress
        : message.sender === undefined
          ? address('unknown')
          : address(message.sender.address);
    const recipients =
      direction === 'outbound'
        ? (chat?.participants.map((participant) => address(participant.address)) ?? [])
        : [ownAddress];
    const replyTo = replyReference(message);
    return {
      providerMessageId: message.guid,
      conversationId,
      direction,
      sender,
      recipients,
      text: messageText(message.content),
      attachments: message.content.attachments.map(mapAttachment),
      ...(replyTo === undefined ? {} : { replyTo }),
      service: mapService(chat?.service ?? message.sender?.service ?? 'iMessage'),
      status: mapStatus(message),
      providerStatus: providerStatus(message),
      createdAt: message.dateCreated,
      ...(message.isSent ? { sentAt: message.dateCreated } : {}),
      ...(message.dateDelivered === undefined ? {} : { deliveredAt: message.dateDelivered }),
      ...(message.dateRead === undefined ? {} : { readAt: message.dateRead }),
      raw: message,
    };
  };

  const syntheticEventMessage = async (
    client: AdvancedIMessage,
    event: Extract<MessageEvent, { readonly messageGuid: string }>,
  ): Promise<ProviderMessage> => {
    try {
      return await mapMessage(client, await client.messages.get(event.messageGuid), event.chatGuid);
    } catch {
      const line = (await connection()).line;
      const text = event.type === 'message.edited' ? messageText(event.content) : '';
      return {
        providerMessageId: event.messageGuid,
        conversationId: event.chatGuid,
        direction: event.isFromMe ? 'outbound' : 'inbound',
        sender: event.actor === undefined ? address(line.phone) : address(event.actor.address),
        recipients: [],
        text,
        attachments: [],
        service: mapService(event.actor?.service ?? 'iMessage'),
        status: event.type === 'message.read' ? 'read' : 'sent',
        providerStatus: event.type,
        createdAt: event.occurredAt,
        ...(event.type === 'message.read' ? { readAt: event.readAt } : {}),
        raw: event,
      };
    }
  };

  const mapStreamEvent = async (
    client: AdvancedIMessage,
    event: MessageEvent,
  ): Promise<ProviderEvent | undefined> => {
    const base = {
      id: `photon:${event.sequence}`,
      providerEventId: String(event.sequence),
      timestamp: event.occurredAt,
      raw: event,
    } as const;
    switch (event.type) {
      case 'message.received':
        return {
          ...base,
          type: event.isFromMe ? 'message.sent' : 'message.received',
          message: await mapMessage(client, event.message, event.chatGuid),
        };
      case 'message.edited':
        return {
          ...base,
          type: 'message.edited',
          message: await syntheticEventMessage(client, event),
        };
      case 'message.read':
        return {
          ...base,
          type: 'message.read',
          message: await syntheticEventMessage(client, event),
        };
      case 'message.unsent':
        return {
          ...base,
          type: 'message.deleted',
          conversationId: event.chatGuid,
          messageId: event.messageGuid,
        };
      case 'message.reactionAdded':
      case 'message.reactionRemoved': {
        const reaction = normalizeReaction(event.reaction);
        if (reaction === undefined) return undefined;
        const line = (await connection()).line;
        return {
          ...base,
          type: event.type === 'message.reactionAdded' ? 'reaction.added' : 'reaction.removed',
          conversationId: event.chatGuid,
          messageId: event.messageGuid,
          actor: event.actor === undefined ? address(line.phone) : address(event.actor.address),
          reaction,
          ...(event.targetPartIndex === undefined ? {} : { partIndex: event.targetPartIndex }),
        };
      }
      case 'message.stickerPlaced':
        return undefined;
    }
  };

  const messages: PhotonMessages = {
    async send(input): Promise<ProviderSentMessage> {
      return run('messages.send', async ({ client }) => {
        let chatId = input.conversationId;
        if (chatId === undefined) {
          const recipients = Array.isArray(input.to) ? input.to : [input.to];
          const result = await client.chats.create(
            recipients.map((recipient) => recipient.value),
            input.idempotencyKey === undefined
              ? undefined
              : { clientMessageId: `${input.idempotencyKey}:chat` },
          );
          chatCache.set(result.chat.guid, result.chat);
          chatId = result.chat.guid;
        }
        const replyTo =
          input.replyTo === undefined
            ? undefined
            : input.replyTo.partIndex === undefined
              ? input.replyTo.messageId
              : {
                  guid: input.replyTo.messageId,
                  partIndex: input.replyTo.partIndex,
                };
        const uploaded = await Promise.all(
          (input.attachments ?? []).map(async (attachment) => {
            return client.attachments.upload({
              fileName: attachmentFilename(attachment),
              data: await attachmentBytes(attachment),
            });
          }),
        );
        const common = {
          ...(input.idempotencyKey === undefined ? {} : { clientMessageId: input.idempotencyKey }),
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        let sent: PhotonMessage;
        if (uploaded.length === 0) {
          sent = await client.messages.sendText(chatId, input.text ?? '', common);
        } else if (uploaded.length === 1 && input.text === undefined) {
          const first = uploaded[0];
          if (first === undefined) throw new ValidationError('Attachment upload failed.');
          sent = await client.messages.sendAttachment(chatId, first.attachment.guid, common);
        } else {
          sent = await client.messages.sendMultipart(
            chatId,
            [
              ...(input.text === undefined ? [] : [{ text: input.text }]),
              ...uploaded.map((result) => ({
                attachmentGuid: result.attachment.guid,
                attachmentName: result.attachment.fileName,
              })),
            ],
            common,
          );
        }
        return (await mapMessage(client, sent, chatId)) as ProviderSentMessage;
      });
    },

    async get(message) {
      try {
        return await run('messages.get', async ({ client }) =>
          mapMessage(client, await client.messages.get(message.messageId), message.conversationId),
        );
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    },
  };

  const conversations: PhotonConversations = {
    async open(input) {
      return run('conversations.open', async ({ client }) => {
        const result = await client.chats.create(
          input.participants.map((participant) => participant.value),
        );
        chatCache.set(result.chat.guid, result.chat);
        return mapConversation(result.chat);
      });
    },

    async get(id) {
      try {
        return await run('conversations.get', async ({ client }) =>
          mapConversation(await getChat(client, id)),
        );
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    },

    async markRead(id) {
      await run('conversations.markRead', async ({ client }) => {
        await client.chats.markRead(id);
      });
    },
  };

  const events: ProviderEvents = {
    subscribe(subscribeOptions: SubscribeOptions = {}) {
      const iterable: AsyncIterable<ProviderEvent> = {
        async *[Symbol.asyncIterator]() {
          const { client } = await connection();
          const live = client.messages.subscribeEvents();
          activeStreams.add(live as TypedEventStream<unknown>);
          const abort = (): void => {
            void live.close();
          };
          subscribeOptions.signal?.addEventListener('abort', abort, {
            once: true,
          });
          const seen = new Set<number>();
          const liveIterator = live[Symbol.asyncIterator]();
          let nextLive = liveIterator.next();
          try {
            if (subscribeOptions.cursor !== undefined) {
              const cursor = Number(subscribeOptions.cursor);
              if (!Number.isSafeInteger(cursor) || cursor < 0) {
                throw new ValidationError(
                  'Photon event cursor must be a non-negative integer sequence.',
                  { provider: 'photon', code: 'invalid_event_cursor' },
                );
              }
              const catchUp = client.events.catchUp(cursor);
              activeStreams.add(catchUp as TypedEventStream<unknown>);
              try {
                for await (const event of catchUp) {
                  if (subscribeOptions.signal?.aborted === true) return;
                  if (event.type === 'catchup.complete') break;
                  if (!event.type.startsWith('message.')) continue;
                  const messageEvent = event as MessageEvent;
                  seen.add(messageEvent.sequence);
                  const mapped = await mapStreamEvent(client, messageEvent);
                  if (mapped !== undefined) yield mapped;
                }
              } finally {
                activeStreams.delete(catchUp as TypedEventStream<unknown>);
                await catchUp.close();
              }
            }
            while (true) {
              const result = await nextLive;
              if (result.done === true) return;
              nextLive = liveIterator.next();
              const event = result.value;
              if (subscribeOptions.signal?.aborted === true) return;
              if (seen.has(event.sequence)) continue;
              const mapped = await mapStreamEvent(client, event);
              if (mapped !== undefined) yield mapped;
            }
          } catch (error) {
            mapError(error, 'events.subscribe');
          } finally {
            subscribeOptions.signal?.removeEventListener('abort', abort);
            activeStreams.delete(live as TypedEventStream<unknown>);
            await live.close();
          }
        },
      };
      return iterable;
    },
  };

  return defineProvider({
    name: 'photon',
    capabilities: PHOTON_CAPABILITIES,
    messages,
    conversations,
    reactions: {
      async add(input) {
        await run('reactions.add', async ({ client }) => {
          await client.messages.setReaction(
            input.conversationId,
            input.messageId,
            mapReaction(input.reaction),
            true,
            input.partIndex === undefined ? undefined : { partIndex: input.partIndex },
          );
        });
      },
      async remove(input) {
        await run('reactions.remove', async ({ client }) => {
          await client.messages.setReaction(
            input.conversationId,
            input.messageId,
            mapReaction(input.reaction),
            false,
            input.partIndex === undefined ? undefined : { partIndex: input.partIndex },
          );
        });
      },
    },
    typing: {
      async start(id) {
        await run('typing.start', async ({ client }) => {
          await client.chats.setTyping(id, true);
        });
      },
      async stop(id) {
        await run('typing.stop', async ({ client }) => {
          await client.chats.setTyping(id, false);
        });
      },
    },
    webhooks: {
      async verify(request) {
        if (config.webhookSecret === undefined) return false;
        const timestamp = request.headers.get('x-spectrum-timestamp');
        const signature = request.headers.get('x-spectrum-signature');
        if (timestamp === null || signature === null) return false;
        const numericTimestamp = Number(timestamp);
        const age = Math.abs(Math.floor(Date.now() / 1_000) - numericTimestamp);
        if (!Number.isFinite(age) || age > WEBHOOK_TOLERANCE_SECONDS) return false;
        const rawBody = await request.text();
        const digest = await hmacSha256(config.webhookSecret, `v0:${timestamp}:${rawBody}`);
        return constantTimeEqual(`v0=${digest}`, signature.toLowerCase());
      },
      async parse(request) {
        const parsed = WebhookPayloadSchema.safeParse(await request.json());
        if (!parsed.success) return [];
        const { message, space } = parsed.data;
        if (message.content.type === 'reaction') {
          const reaction = normalizeWebhookReaction(message.content.emoji);
          if (reaction === undefined) return [];
          const providerEventId = request.headers.get('x-spectrum-webhook-id');
          return [
            {
              id: message.id,
              ...(providerEventId === null ? {} : { providerEventId }),
              type: 'reaction.added',
              timestamp: new Date(message.timestamp),
              conversationId: space.id,
              messageId: message.content.target.id,
              actor: address(message.sender.id),
              reaction,
              raw: parsed.data,
            },
          ];
        }
        const own = address(space.phone ?? config.phone ?? SHARED_PHONE);
        const providerEventId = request.headers.get('x-spectrum-webhook-id');
        return [
          {
            id: message.id,
            ...(providerEventId === null ? {} : { providerEventId }),
            type: 'message.received',
            timestamp: new Date(message.timestamp),
            message: {
              providerMessageId: message.id,
              conversationId: space.id,
              direction: 'inbound',
              sender: address(message.sender.id),
              recipients: [own],
              text: message.content.type === 'text' ? message.content.text : '',
              attachments: webhookAttachments(message.content),
              service: 'imessage',
              status: 'delivered',
              providerStatus: 'received',
              createdAt: new Date(message.timestamp),
              raw: message,
            },
            raw: parsed.data,
          },
        ];
      },
    },
    events,
    connection: {
      async getLine() {
        return (await connection()).line;
      },
    },
    async close() {
      await Promise.all([...activeStreams].map(async (stream) => await stream.close()));
      activeStreams.clear();
      if (connectionPromise !== undefined) {
        await (await connectionPromise).close();
      }
    },
  });
}
