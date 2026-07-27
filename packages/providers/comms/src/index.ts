import { z } from 'zod';

import type {
  IMessageAddress,
  IMessageCapabilities,
  IMessageDirection,
  IMessageProvider,
  IMessageService,
  IMessageStatus,
  OpenConversationInput,
  ProviderConversation,
  ProviderConversations,
  ProviderMessages,
  ProviderSentMessage,
  SendMessageInput,
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

const DEFAULT_BASE_URL = 'https://osis.co/api/v1/comms';

export const COMMS_CAPABILITIES = {
  attachments: {
    download: false,
  },
  messages: {
    text: true,
    attachments: false,
    replies: false,
    get: false,
    edit: false,
    delete: false,
  },
  conversations: {
    direct: true,
    groups: false,
    get: false,
    markRead: false,
  },
  interactions: {
    reactions: false,
    typingStart: false,
    typingStop: false,
    readReceipts: false,
  },
  events: {
    webhooks: false,
    stream: false,
  },
} as const satisfies IMessageCapabilities;

export interface CommsOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

export type CommsChannel = 'imessage' | 'sms';

export type CommsSendMessageInput = SendMessageInput & {
  /** Prefer a specific Comms channel. Omit to let Comms choose. */
  readonly channel?: CommsChannel;
};

interface CommsListMessagesFilterOptions {
  readonly direction?: IMessageDirection;
  readonly limit?: number;
}

export type CommsListMessagesOptions = CommsListMessagesFilterOptions &
  (
    | {
        readonly conversationId: string;
        readonly since?: Date | string;
      }
    | {
        readonly conversationId?: string;
        readonly since: Date | string;
      }
  );

export interface CommsMessage {
  readonly id: string;
  readonly body: string;
  readonly direction: IMessageDirection;
  readonly conversationId?: string;
  readonly to?: string;
  readonly from?: string;
  readonly channel?: string;
  readonly status?: string;
  readonly createdAt?: Date;
  readonly raw: unknown;
}

export interface CommsListConversationsOptions {
  readonly state?: string;
  readonly query?: string;
  readonly limit?: number;
}

export interface CommsConversation {
  readonly id: string;
  readonly state?: string;
  readonly raw: unknown;
}

export interface CommsListDeliveryEventsOptions {
  readonly limit?: number;
}

export interface CommsListContactsOptions {
  readonly query?: string;
  readonly limit?: number;
}

export interface CommsUpsertContactInput {
  readonly phone?: string;
  readonly name?: string;
  readonly email?: string;
  readonly tags?: readonly string[];
}

export interface CommsContact {
  readonly id: string;
  readonly phone?: string;
  readonly name?: string;
  readonly email?: string;
  readonly tags?: readonly string[];
  readonly raw: unknown;
}

export interface CommsDeliveryEvent {
  readonly id: string;
  readonly event?: string;
  readonly status?: string;
  readonly attempts?: number;
  readonly lastStatus?: string;
  readonly createdAt?: Date;
  readonly raw: unknown;
}

export interface CommsCreateWebhookEndpointInput {
  readonly url: string;
  readonly events: readonly [string, ...string[]];
}

export interface CommsWebhookEndpoint {
  readonly id: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly raw: unknown;
}

export interface CommsMessages extends Omit<ProviderMessages, 'send' | 'get' | 'edit' | 'delete'> {
  send(input: CommsSendMessageInput): Promise<ProviderSentMessage>;
  list(options: CommsListMessagesOptions): Promise<readonly CommsMessage[]>;
}

export interface CommsConversations extends Omit<ProviderConversations, 'get' | 'markRead'> {
  list(options?: CommsListConversationsOptions): Promise<readonly CommsConversation[]>;
}

export interface CommsDeliveryEvents {
  list(options?: CommsListDeliveryEventsOptions): Promise<readonly CommsDeliveryEvent[]>;
}

export interface CommsContacts {
  list(options?: CommsListContactsOptions): Promise<readonly CommsContact[]>;
  upsert(input: CommsUpsertContactInput): Promise<CommsContact>;
}

export interface CommsWebhookEndpoints {
  list(): Promise<readonly CommsWebhookEndpoint[]>;
  create(input: CommsCreateWebhookEndpointInput): Promise<CommsWebhookEndpoint>;
}

export interface CommsProvider extends IMessageProvider<'comms', typeof COMMS_CAPABILITIES> {
  readonly messages: CommsMessages;
  readonly conversations: CommsConversations;
  readonly contacts: CommsContacts;
  readonly deliveryEvents: CommsDeliveryEvents;
  readonly webhookEndpoints: CommsWebhookEndpoints;
}

const E164Schema = z.string().regex(/^\+[1-9]\d{6,14}$/u, 'Expected an E.164 phone number.');
const OptionalStringSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => (value === null || value === '' ? undefined : value));
const OptionalDateSchema = z
  .union([z.string(), z.number().finite()])
  .nullable()
  .optional()
  .transform((value) => (value === null || value === '' ? undefined : value));

const MessageSchema = z
  .object({
    id: z.string().min(1),
    body: z.string(),
    direction: z.enum(['inbound', 'outbound']),
    conversation_id: OptionalStringSchema,
    to: OptionalStringSchema,
    from: OptionalStringSchema,
    channel: OptionalStringSchema,
    status: OptionalStringSchema,
    created_at: OptionalDateSchema,
    sent_at: OptionalDateSchema,
    delivered_at: OptionalDateSchema,
    read_at: OptionalDateSchema,
  })
  .loose();
const SendResponseSchema = z
  .object({
    message: MessageSchema,
    duplicate: z.boolean().optional(),
  })
  .loose();
const MessagesResponseSchema = z.object({ messages: z.array(MessageSchema) }).loose();
const ConversationSchema = z
  .object({
    id: z.string().min(1),
    state: OptionalStringSchema,
  })
  .loose();
const ConversationsResponseSchema = z
  .object({ conversations: z.array(ConversationSchema) })
  .loose();
const DeliveryEventSchema = z
  .object({
    id: z.string().min(1),
    event: OptionalStringSchema,
    status: OptionalStringSchema,
    attempts: z.number().int().nonnegative().nullable().optional(),
    last_status: OptionalStringSchema,
    created_at: OptionalDateSchema,
  })
  .loose();
const DeliveryEventsResponseSchema = z.object({ deliveries: z.array(DeliveryEventSchema) }).loose();
const ContactSchema = z
  .object({
    id: z.string().min(1),
    phone: OptionalStringSchema,
    name: OptionalStringSchema,
    email: OptionalStringSchema,
    tags: z.array(z.string()).nullable().optional(),
  })
  .loose();
const ContactsResponseSchema = z.object({ contacts: z.array(ContactSchema) }).loose();
const ContactResponseSchema = z.object({ contact: ContactSchema }).loose();
const WebhookEndpointSchema = z
  .object({
    id: z.string().min(1),
    url: z.url(),
    events: z.array(z.string()),
  })
  .loose();
const WebhookEndpointResponseSchema = z.object({ webhook: WebhookEndpointSchema }).loose();
const WebhookEndpointsResponseSchema = z
  .object({ webhooks: z.array(WebhookEndpointSchema) })
  .loose();
const ApiErrorSchema = z
  .object({
    error: OptionalStringSchema,
    message: OptionalStringSchema,
    retry_after: z.union([z.number().nonnegative(), z.string()]).nullable().optional(),
  })
  .loose();

type MessagePayload = z.infer<typeof MessageSchema>;
type ConversationPayload = z.infer<typeof ConversationSchema>;
type DeliveryEventPayload = z.infer<typeof DeliveryEventSchema>;
type ContactPayload = z.infer<typeof ContactSchema>;
type WebhookEndpointPayload = z.infer<typeof WebhookEndpointSchema>;

interface RequestOptions {
  readonly operation: string;
  readonly send?: boolean;
  readonly idempotencyKey?: string;
}

function address(value: string): IMessageAddress {
  return { kind: 'phone', value };
}

function unknownAddress(): IMessageAddress {
  return address('unknown');
}

function parseDate(value: string | number | null | undefined): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const result = new Date(value);
  return Number.isNaN(result.valueOf()) ? undefined : result;
}

function mapStatus(value: string | null | undefined): IMessageStatus {
  switch (value?.toLowerCase()) {
    case 'accepted':
      return 'accepted';
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
}

function mapService(value: string | null | undefined): IMessageService {
  switch (value?.toLowerCase()) {
    case 'imessage':
      return 'imessage';
    case 'sms':
      return 'sms';
    default:
      return 'unknown';
  }
}

function mapMessage(payload: MessagePayload, raw: unknown): CommsMessage {
  const createdAt = parseDate(payload.created_at);
  return {
    id: payload.id,
    body: payload.body,
    direction: payload.direction,
    ...(payload.conversation_id === undefined ? {} : { conversationId: payload.conversation_id }),
    ...(payload.to === undefined ? {} : { to: payload.to }),
    ...(payload.from === undefined ? {} : { from: payload.from }),
    ...(payload.channel === undefined ? {} : { channel: payload.channel }),
    ...(payload.status === undefined ? {} : { status: payload.status }),
    ...(createdAt === undefined ? {} : { createdAt }),
    raw,
  };
}

function mapConversation(payload: ConversationPayload, raw: unknown): CommsConversation {
  return {
    id: payload.id,
    ...(payload.state === undefined ? {} : { state: payload.state }),
    raw,
  };
}

function mapDeliveryEvent(payload: DeliveryEventPayload, raw: unknown): CommsDeliveryEvent {
  const createdAt = parseDate(payload.created_at);
  return {
    id: payload.id,
    ...(payload.event === undefined ? {} : { event: payload.event }),
    ...(payload.status === undefined ? {} : { status: payload.status }),
    ...(payload.attempts === undefined || payload.attempts === null
      ? {}
      : { attempts: payload.attempts }),
    ...(payload.last_status === undefined ? {} : { lastStatus: payload.last_status }),
    ...(createdAt === undefined ? {} : { createdAt }),
    raw,
  };
}

function mapContact(payload: ContactPayload, raw: unknown): CommsContact {
  return {
    id: payload.id,
    ...(payload.phone === undefined ? {} : { phone: payload.phone }),
    ...(payload.name === undefined ? {} : { name: payload.name }),
    ...(payload.email === undefined ? {} : { email: payload.email }),
    ...(payload.tags === undefined || payload.tags === null ? {} : { tags: payload.tags }),
    raw,
  };
}

function mapWebhookEndpoint(payload: WebhookEndpointPayload, raw: unknown): CommsWebhookEndpoint {
  return {
    id: payload.id,
    url: payload.url,
    events: payload.events,
    raw,
  };
}

function rawArray(raw: unknown, key: string): readonly unknown[] {
  return (raw as Readonly<Record<string, readonly unknown[]>>)[key] ?? [];
}

function rawObject(raw: unknown, key: string): unknown {
  return (raw as Readonly<Record<string, unknown>>)[key];
}

function appendQuery(
  path: string,
  values: Readonly<Record<string, string | number | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}

function retryAfterSeconds(response: Response, raw: unknown): number | undefined {
  const parsed = ApiErrorSchema.safeParse(raw);
  const value = parsed.success ? parsed.data.retry_after : undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }

  const header = response.headers.get('retry-after');
  if (header === null) return undefined;
  const numeric = Number(header);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function errorMessage(raw: unknown, fallback: string): string {
  const parsed = ApiErrorSchema.safeParse(raw);
  if (!parsed.success) return fallback;
  return parsed.data.error ?? parsed.data.message ?? fallback;
}

function resolveDestination(input: SendMessageInput): {
  readonly to?: string;
  readonly conversationId?: string;
} {
  if (input.conversationId !== undefined) {
    if (input.conversationId.trim().length === 0) {
      throw new ValidationError('Comms conversationId must not be empty.', {
        provider: 'comms',
        code: 'invalid_conversation_id',
      });
    }
    const phone = E164Schema.safeParse(input.conversationId);
    return phone.success ? { to: phone.data } : { conversationId: input.conversationId };
  }

  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  if (recipients.length !== 1 || recipients[0]?.kind !== 'phone') {
    throw new ValidationError('Comms requires exactly one phone recipient.', {
      provider: 'comms',
      code: 'invalid_recipient',
    });
  }

  const parsed = E164Schema.safeParse(recipients[0].value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid phone recipient.', {
      provider: 'comms',
      code: 'invalid_recipient',
      raw: parsed.error,
    });
  }
  return { to: parsed.data };
}

export function comms(options: CommsOptions = {}): CommsProvider {
  const apiKey = options.apiKey ?? process.env['COMMS_API_KEY'];
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');

  const request = async (
    path: string,
    init: RequestInit = {},
    requestOptions: RequestOptions,
  ): Promise<unknown> => {
    if (apiKey === undefined || apiKey.length === 0) {
      throw new AuthenticationError(
        'Comms API key is required. Pass apiKey or set COMMS_API_KEY.',
        {
          provider: 'comms',
          code: 'missing_api_key',
        },
      );
    }

    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${apiKey}`);
    headers.set('accept', 'application/json');
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    if (requestOptions.idempotencyKey !== undefined) {
      headers.set('idempotency-key', requestOptions.idempotencyKey);
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      const ErrorType = requestOptions.send ? AmbiguousDeliveryError : ProviderUnavailableError;
      throw new ErrorType(`Comms ${requestOptions.operation} request failed.`, {
        provider: 'comms',
        code: 'network_error',
        retryable: true,
        raw: error,
      });
    }

    const text = await response.text();
    let raw: unknown;
    try {
      raw = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      raw = text;
    }

    if (response.ok) return raw;

    const message = errorMessage(raw, `Comms ${requestOptions.operation} failed.`);
    const common = {
      provider: 'comms',
      statusCode: response.status,
      raw,
    } as const;

    if (response.status === 400 || response.status === 422) {
      throw new ValidationError(message, { ...common, code: 'validation_error' });
    }
    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError(message, { ...common, code: 'authentication_error' });
    }
    if (response.status === 404) {
      throw new NotFoundError(message, { ...common, code: 'not_found' });
    }
    if (response.status === 409) {
      throw new ConflictError(message, { ...common, code: 'conflict' });
    }
    if (response.status === 429) {
      const retryAfter = retryAfterSeconds(response, raw);
      throw new RateLimitError(message, {
        ...common,
        code: 'rate_limited',
        retryable: true,
        ...(retryAfter === undefined ? {} : { retryAfter }),
      });
    }
    if (requestOptions.send && (response.status === 408 || response.status >= 500)) {
      throw new AmbiguousDeliveryError(message, {
        ...common,
        code: 'ambiguous_delivery',
        retryable: true,
      });
    }
    if (response.status >= 500) {
      throw new ProviderUnavailableError(message, {
        ...common,
        code: 'provider_unavailable',
        retryable: true,
      });
    }
    throw new IMessageSDKError(message, {
      ...common,
      code: 'provider_error',
    });
  };

  const messages: CommsMessages = {
    async send(input): Promise<ProviderSentMessage> {
      if (input.attachments !== undefined && input.attachments.length > 0) {
        throw new ValidationError('Comms does not currently document attachment sends.', {
          provider: 'comms',
          code: 'unsupported_attachment',
        });
      }
      if (input.replyTo !== undefined) {
        throw new ValidationError('Comms does not currently document message replies.', {
          provider: 'comms',
          code: 'unsupported_reply',
        });
      }
      if (input.text === undefined || input.text.trim().length === 0) {
        throw new ValidationError('Comms requires non-empty message text.', {
          provider: 'comms',
          code: 'missing_text',
        });
      }

      const destination = resolveDestination(input);
      const raw = await request(
        '/messages',
        {
          method: 'POST',
          body: JSON.stringify({
            ...(destination.to === undefined ? {} : { to: destination.to }),
            ...(destination.conversationId === undefined
              ? {}
              : { conversation_id: destination.conversationId }),
            body: input.text,
            ...(input.channel === undefined ? {} : { channel: input.channel }),
          }),
        },
        {
          operation: 'send message',
          send: true,
          ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        },
      );
      const parsed = SendResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new AmbiguousDeliveryError('Comms returned an invalid send response.', {
          provider: 'comms',
          code: 'invalid_provider_response',
          retryable: false,
          raw,
        });
      }

      const message = parsed.data.message;
      const createdAt = parseDate(message.created_at) ?? new Date();
      const status = mapStatus(message.status ?? 'accepted');
      const sentAt = parseDate(message.sent_at);
      const deliveredAt = parseDate(message.delivered_at);
      const readAt = parseDate(message.read_at);
      const recipient = message.to ?? destination.to;
      const conversationId =
        message.conversation_id ?? destination.conversationId ?? destination.to;

      return {
        providerMessageId: message.id,
        ...(conversationId === undefined ? {} : { conversationId }),
        direction: 'outbound',
        sender: message.from === undefined ? unknownAddress() : address(message.from),
        recipients: recipient === undefined ? [] : [address(recipient)],
        text: message.body,
        attachments: [],
        service: mapService(message.channel),
        status,
        providerStatus: parsed.data.duplicate ? 'duplicate' : (message.status ?? 'accepted'),
        createdAt,
        ...(sentAt === undefined ? {} : { sentAt }),
        ...(deliveredAt === undefined ? {} : { deliveredAt }),
        ...(readAt === undefined ? {} : { readAt }),
        raw,
      };
    },
    async list(options) {
      if (
        (options.conversationId === undefined || options.conversationId.trim().length === 0) &&
        (options.since === undefined ||
          (typeof options.since === 'string' && options.since.trim().length === 0))
      ) {
        throw new ValidationError('Comms message listing requires conversationId or since.', {
          provider: 'comms',
          code: 'missing_message_list_bound',
        });
      }
      const raw = await request(
        appendQuery('/messages', {
          conversation_id: options.conversationId,
          since: options.since instanceof Date ? options.since.toISOString() : options.since,
          direction: options.direction,
          limit: options.limit,
        }),
        {},
        { operation: 'list messages' },
      );
      const parsed = MessagesResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new IMessageSDKError('Comms returned an invalid messages response.', {
          provider: 'comms',
          code: 'invalid_provider_response',
          raw,
        });
      }
      const rawMessages = rawArray(raw, 'messages');
      return parsed.data.messages.map((message, index) => mapMessage(message, rawMessages[index]));
    },
  };

  const conversations: CommsConversations = {
    async open(input: OpenConversationInput): Promise<ProviderConversation> {
      if (input.participants.length !== 1 || input.participants[0].kind !== 'phone') {
        throw new ValidationError('Comms supports one direct phone participant.', {
          provider: 'comms',
          code: 'invalid_participants',
        });
      }
      const parsed = E164Schema.safeParse(input.participants[0].value);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid participant.', {
          provider: 'comms',
          code: 'invalid_participant',
          raw: parsed.error,
        });
      }
      return {
        providerConversationId: parsed.data,
        participants: [address(parsed.data)],
        raw: input,
      };
    },
    async list(options = {}) {
      const raw = await request(
        appendQuery('/conversations', {
          state: options.state,
          q: options.query,
          limit: options.limit,
        }),
        {},
        { operation: 'list conversations' },
      );
      const parsed = ConversationsResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new IMessageSDKError('Comms returned an invalid conversations response.', {
          provider: 'comms',
          code: 'invalid_provider_response',
          raw,
        });
      }
      const rawConversations = rawArray(raw, 'conversations');
      return parsed.data.conversations.map((conversation, index) =>
        mapConversation(conversation, rawConversations[index]),
      );
    },
  };

  const deliveryEvents: CommsDeliveryEvents = {
    async list(options = {}) {
      const raw = await request(
        appendQuery('/events', { limit: options.limit }),
        {},
        { operation: 'list delivery events' },
      );
      const parsed = DeliveryEventsResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new IMessageSDKError('Comms returned an invalid delivery events response.', {
          provider: 'comms',
          code: 'invalid_provider_response',
          raw,
        });
      }
      const rawDeliveries = rawArray(raw, 'deliveries');
      return parsed.data.deliveries.map((event, index) =>
        mapDeliveryEvent(event, rawDeliveries[index]),
      );
    },
  };

  const contacts: CommsContacts = {
    async list(options = {}) {
      const raw = await request(
        appendQuery('/contacts', { q: options.query, limit: options.limit }),
        {},
        { operation: 'list contacts' },
      );
      const parsed = ContactsResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new IMessageSDKError('Comms returned an invalid contacts response.', {
          provider: 'comms',
          code: 'invalid_provider_response',
          raw,
        });
      }
      const rawContacts = rawArray(raw, 'contacts');
      return parsed.data.contacts.map((contact, index) => mapContact(contact, rawContacts[index]));
    },
    async upsert(input) {
      if (
        input.phone === undefined &&
        input.name === undefined &&
        input.email === undefined &&
        input.tags === undefined
      ) {
        throw new ValidationError('Comms contact upsert requires at least one field.', {
          provider: 'comms',
          code: 'invalid_contact',
        });
      }
      if (input.phone !== undefined && !E164Schema.safeParse(input.phone).success) {
        throw new ValidationError('Comms contact phone must be an E.164 phone number.', {
          provider: 'comms',
          code: 'invalid_contact_phone',
        });
      }
      if (input.email !== undefined && !z.email().safeParse(input.email).success) {
        throw new ValidationError('Comms contact email must be a valid email address.', {
          provider: 'comms',
          code: 'invalid_contact_email',
        });
      }

      const raw = await request(
        '/contacts',
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
        { operation: 'upsert contact' },
      );
      const parsed = ContactResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new IMessageSDKError('Comms returned an invalid contact response.', {
          provider: 'comms',
          code: 'invalid_provider_response',
          raw,
        });
      }
      return mapContact(parsed.data.contact, rawObject(raw, 'contact'));
    },
  };

  const webhookEndpoints: CommsWebhookEndpoints = {
    async list() {
      const raw = await request('/webhooks', {}, { operation: 'list webhook endpoints' });
      const parsed = WebhookEndpointsResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new IMessageSDKError('Comms returned an invalid webhooks response.', {
          provider: 'comms',
          code: 'invalid_provider_response',
          raw,
        });
      }
      const rawWebhooks = rawArray(raw, 'webhooks');
      return parsed.data.webhooks.map((webhook, index) =>
        mapWebhookEndpoint(webhook, rawWebhooks[index]),
      );
    },
    async create(input) {
      const url = z.url().safeParse(input.url);
      if (!url.success || new URL(input.url).protocol !== 'https:') {
        throw new ValidationError('Comms webhook endpoint URLs must use HTTPS.', {
          provider: 'comms',
          code: 'invalid_webhook_url',
          raw: url.success ? input.url : url.error,
        });
      }
      if (input.events.length === 0 || input.events.some((event) => event.length === 0)) {
        throw new ValidationError('Comms webhook endpoints require at least one event.', {
          provider: 'comms',
          code: 'invalid_webhook_events',
        });
      }

      const raw = await request(
        '/webhooks',
        {
          method: 'POST',
          body: JSON.stringify({ url: input.url, events: input.events }),
        },
        { operation: 'create webhook endpoint' },
      );
      const parsed = WebhookEndpointResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new IMessageSDKError('Comms returned an invalid webhook response.', {
          provider: 'comms',
          code: 'invalid_provider_response',
          raw,
        });
      }
      return mapWebhookEndpoint(parsed.data.webhook, rawObject(raw, 'webhook'));
    },
  };

  return defineProvider({
    name: 'comms',
    capabilities: COMMS_CAPABILITIES,
    messages,
    conversations,
    contacts,
    deliveryEvents,
    webhookEndpoints,
  });
}
