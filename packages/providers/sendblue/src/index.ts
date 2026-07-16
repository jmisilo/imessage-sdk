import { z } from 'zod';

import type {
  AddReactionInput,
  IMessageAddress,
  IMessageAttachment,
  IMessageAttachmentInput,
  IMessageCapabilities,
  IMessageProvider,
  IMessageService,
  IMessageStatus,
  MessageLocator,
  OpenConversationInput,
  ProviderConversation,
  ProviderConversations,
  ProviderEvent,
  ProviderMessage,
  ProviderMessages,
  ProviderSentMessage,
  ProviderTyping,
  ProviderWebhooks,
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

const DEFAULT_BASE_URL = 'https://api.sendblue.com';
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 18_996;

export const SENDBLUE_CAPABILITIES = {
  attachments: {
    download: false,
  },
  messages: {
    text: true,
    attachments: true,
    replies: false,
    get: true,
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
    typingStart: true,
    typingStop: true,
    readReceipts: false,
  },
  events: {
    webhooks: true,
    stream: false,
  },
} as const satisfies IMessageCapabilities;

export type SendblueCapabilities<TMarkReadEnabled extends boolean = false> = Omit<
  typeof SENDBLUE_CAPABILITIES,
  'conversations'
> & {
  readonly conversations: Omit<typeof SENDBLUE_CAPABILITIES.conversations, 'markRead'> & {
    readonly markRead: TMarkReadEnabled;
  };
};

interface SendblueBaseOptions {
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly fromNumber?: string;
  readonly webhookSecret?: string;
  readonly baseUrl?: string;
}

export type SendblueOptions<TMarkReadEnabled extends boolean = false> = SendblueBaseOptions &
  ([TMarkReadEnabled] extends [true]
    ? {
        /** Enable only after Sendblue has activated the manual mark-read endpoint. */
        readonly markReadEnabled: true;
      }
    : [TMarkReadEnabled] extends [false]
      ? { readonly markReadEnabled?: false }
      : {
          /** A dynamic boolean produces a correspondingly dynamic capability type. */
          readonly markReadEnabled: TMarkReadEnabled;
        });

export interface SendblueMessageStatus {
  readonly messageId: string;
  readonly conversationId: string;
  readonly status: IMessageStatus;
  readonly providerStatus?: string;
  readonly service: IMessageService;
  readonly sentAt?: Date;
  readonly deliveredAt?: Date;
  readonly error?: string;
  readonly raw: unknown;
}

export interface SendblueMessages extends Omit<ProviderMessages, 'get' | 'edit' | 'delete'> {
  get(message: MessageLocator): Promise<ProviderMessage | null>;
  getStatus(message: MessageLocator): Promise<SendblueMessageStatus | null>;
}

export type SendblueConversations<TMarkReadEnabled extends boolean = false> = Omit<
  ProviderConversations,
  'get' | 'markRead'
> &
  (TMarkReadEnabled extends true
    ? { markRead(conversationId: string): Promise<void> }
    : Record<never, never>);

export interface SendblueTapbacks {
  /** Sendblue currently documents adding tapbacks, but not removing them. */
  add(input: AddReactionInput): Promise<void>;
}

export interface SendblueProvider<
  TMarkReadEnabled extends boolean = false,
> extends IMessageProvider<'sendblue', SendblueCapabilities<TMarkReadEnabled>> {
  readonly messages: SendblueMessages;
  readonly conversations: SendblueConversations<TMarkReadEnabled>;
  readonly typing: Required<ProviderTyping>;
  readonly webhooks: ProviderWebhooks;
  readonly tapbacks: SendblueTapbacks;
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
    message_handle: z.string().min(1),
    content: z.string().nullable().optional(),
    is_outbound: z.boolean().optional(),
    status: OptionalStringSchema,
    date_created: OptionalDateSchema,
    date_sent: OptionalDateSchema,
    date_delivered: OptionalDateSchema,
    date_read: OptionalDateSchema,
    date_updated: OptionalDateSchema,
    from_number: OptionalStringSchema,
    number: OptionalStringSchema,
    to_number: OptionalStringSchema,
    sendblue_number: OptionalStringSchema,
    media_url: OptionalStringSchema,
    service: OptionalStringSchema,
    was_downgraded: z.boolean().nullable().optional(),
    message_type: OptionalStringSchema,
    group_id: OptionalStringSchema,
    error_code: z.union([z.string(), z.number()]).nullable().optional(),
    error_message: OptionalStringSchema,
    error_reason: OptionalStringSchema,
    error_detail: OptionalStringSchema,
  })
  .loose();

const MessageEnvelopeSchema = z.object({ data: z.unknown() }).loose();
const UploadResponseSchema = z.object({ media_url: z.url() }).loose();
const ApiErrorSchema = z
  .object({
    message: OptionalStringSchema,
    error: OptionalStringSchema,
    error_message: OptionalStringSchema,
    error_code: z.union([z.string(), z.number()]).nullable().optional(),
    status_code: z.number().optional(),
  })
  .loose();
const TypingWebhookSchema = z
  .object({
    number: E164Schema,
    is_typing: z.boolean(),
    from_number: E164Schema,
    timestamp: OptionalDateSchema,
  })
  .loose();

type SendblueMessagePayload = z.infer<typeof MessageSchema>;

function address(value: string): IMessageAddress {
  return { kind: 'phone', value };
}

function parseDate(value: string | number | null | undefined): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const result = new Date(value);
  return Number.isNaN(result.valueOf()) ? undefined : result;
}

function mapStatus(value: string | null | undefined): IMessageStatus {
  switch (value?.toUpperCase()) {
    case 'REGISTERED':
    case 'PENDING':
    case 'QUEUED':
      return 'pending';
    case 'ACCEPTED':
      return 'accepted';
    case 'SUCCESS':
    case 'SENT':
      return 'sent';
    case 'RECEIVED':
    case 'DELIVERED':
      return 'delivered';
    case 'READ':
      return 'read';
    case 'DECLINED':
    case 'ERROR':
    case 'FAILED':
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
    case 'mms':
      return 'sms';
    case 'rcs':
      return 'rcs';
    default:
      return 'unknown';
  }
}

function attachmentKind(url: string): IMessageAttachment['kind'] {
  const path = url.split(/[?#]/u, 1)[0]?.toLowerCase() ?? '';
  if (/\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/u.test(path)) return 'image';
  if (/\.(?:3gp|avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/u.test(path)) return 'video';
  return 'file';
}

function contactNumber(raw: SendblueMessagePayload, fallback: string): string {
  if (raw.message_type === 'group' || raw.group_id !== undefined) {
    return raw.group_id ?? fallback;
  }
  if (raw.is_outbound === true) return raw.number ?? raw.to_number ?? fallback;
  return raw.number ?? raw.from_number ?? fallback;
}

function mapProviderMessage(
  raw: SendblueMessagePayload,
  fallbackConversationId: string,
  configuredFromNumber?: string,
  sourceRaw: unknown = raw,
): ProviderMessage {
  const direction = raw.is_outbound === true ? 'outbound' : 'inbound';
  const conversationId = contactNumber(raw, fallbackConversationId);
  const ownNumber = raw.sendblue_number ?? configuredFromNumber ?? raw.to_number ?? 'unknown';
  const senderValue = direction === 'outbound' ? (raw.from_number ?? ownNumber) : conversationId;
  const recipientValue =
    direction === 'outbound' ? (raw.to_number ?? raw.number ?? conversationId) : ownNumber;
  const providerStatus = raw.status ?? undefined;
  const status = mapStatus(providerStatus);
  const createdAt =
    parseDate(raw.date_sent) ??
    parseDate(raw.date_created) ??
    parseDate(raw.date_updated) ??
    new Date();
  const updatedAt = parseDate(raw.date_updated);
  const deliveredAt =
    parseDate(raw.date_delivered) ??
    (status === 'delivered' || status === 'read' ? updatedAt : undefined);
  const readAt = parseDate(raw.date_read) ?? (status === 'read' ? updatedAt : undefined);
  const mediaUrl = raw.media_url === null || raw.media_url === '' ? undefined : raw.media_url;
  const attachments: readonly IMessageAttachment[] =
    mediaUrl === undefined
      ? []
      : [
          {
            kind: attachmentKind(mediaUrl),
            url: mediaUrl,
            raw: { media_url: mediaUrl },
          },
        ];
  return {
    providerMessageId: raw.message_handle,
    conversationId,
    direction,
    sender: address(senderValue),
    recipients: [address(recipientValue)],
    text: raw.content ?? '',
    attachments,
    service: raw.was_downgraded === true ? 'sms' : mapService(raw.service),
    status,
    ...(providerStatus === undefined ? {} : { providerStatus }),
    createdAt,
    ...(direction === 'outbound' ? { sentAt: parseDate(raw.date_sent) ?? createdAt } : {}),
    ...(deliveredAt === undefined ? {} : { deliveredAt }),
    ...(readAt === undefined ? {} : { readAt }),
    raw: sourceRaw,
  };
}

function parseMessage(raw: unknown): SendblueMessagePayload | undefined {
  const envelope = MessageEnvelopeSchema.safeParse(raw);
  const candidate = envelope.success ? envelope.data.data : raw;
  const parsed = MessageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function requirePhone(value: string, field: string): string {
  const parsed = E164Schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`${field} must be an E.164 phone number.`, {
      provider: 'sendblue',
      code: 'invalid_phone_number',
      raw: parsed.error,
    });
  }
  return parsed.data;
}

function oneRecipient(input: {
  readonly conversationId?: string;
  readonly to?: IMessageAddress | readonly IMessageAddress[];
}): string {
  if (input.conversationId !== undefined) {
    return requirePhone(input.conversationId, 'conversationId');
  }
  const recipients = input.to === undefined ? [] : 'value' in input.to ? [input.to] : input.to;
  if (recipients.length !== 1 || recipients[0]?.kind !== 'phone') {
    throw new ValidationError('Sendblue requires exactly one phone recipient.', {
      provider: 'sendblue',
      code: 'single_phone_recipient_required',
    });
  }
  return requirePhone(recipients[0].value, 'to');
}

function filenameForAttachment(attachment: {
  readonly kind: IMessageAttachment['kind'];
  readonly filename?: string;
  readonly contentType?: string;
}): string {
  if (attachment.filename !== undefined && attachment.filename.length > 0) {
    return attachment.filename;
  }
  const extension =
    attachment.contentType?.split('/')[1]?.split(/[;+]/u, 1)[0] ??
    (attachment.kind === 'image' ? 'jpg' : attachment.kind === 'video' ? 'mp4' : 'bin');
  return `attachment.${extension}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function webhookLine(raw: SendblueMessagePayload): string | undefined {
  if (raw.sendblue_number !== undefined && raw.sendblue_number !== null) return raw.sendblue_number;
  return raw.is_outbound === true ? (raw.from_number ?? undefined) : (raw.to_number ?? undefined);
}

function isDirectMessage(raw: SendblueMessagePayload): boolean {
  return raw.message_type !== 'group' && raw.group_id === undefined;
}

function mapWebhookMessage(
  raw: SendblueMessagePayload,
  sourceRaw: unknown = raw,
): ProviderEvent | undefined {
  if (!isDirectMessage(raw)) return undefined;
  const providerStatus = raw.status?.toUpperCase();
  const timestamp = parseDate(raw.date_updated) ?? parseDate(raw.date_sent) ?? new Date();
  let type: 'message.received' | 'message.sent' | 'message.delivered' | 'message.failed';
  if (raw.is_outbound !== true) {
    type = 'message.received';
  } else if (providerStatus === 'DELIVERED') {
    type = 'message.delivered';
  } else if (
    providerStatus === 'ERROR' ||
    providerStatus === 'DECLINED' ||
    providerStatus === 'FAILED'
  ) {
    type = 'message.failed';
  } else if (providerStatus === 'READ') {
    return undefined;
  } else {
    type = 'message.sent';
  }
  return {
    id: `sendblue:${raw.message_handle}:${providerStatus ?? 'UNKNOWN'}:${timestamp.valueOf()}`,
    type,
    timestamp,
    message: mapProviderMessage(raw, contactNumber(raw, 'unknown'), undefined, sourceRaw),
    raw: sourceRaw,
  };
}

function requirePublicUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ValidationError('Sendblue attachment URLs must be valid public HTTP(S) URLs.', {
      provider: 'sendblue',
      code: 'invalid_attachment_url',
      raw: cause,
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Sendblue attachment URLs must be valid public HTTP(S) URLs.', {
      provider: 'sendblue',
      code: 'invalid_attachment_url',
      raw: value,
    });
  }
  return value;
}

function assertOperationSucceeded(raw: unknown, operation: string): void {
  const parsed = ApiErrorSchema.safeParse(raw);
  if (!parsed.success) return;
  const status =
    typeof raw === 'object' && raw !== null && 'status' in raw
      ? (raw as { readonly status?: unknown }).status
      : undefined;
  if (typeof status !== 'string' || status.toUpperCase() !== 'ERROR') return;
  throw new IMessageSDKError(
    parsed.data.error_message ??
      parsed.data.message ??
      parsed.data.error ??
      `Sendblue ${operation} failed.`,
    {
      provider: 'sendblue',
      code:
        parsed.data.error_code === undefined || parsed.data.error_code === null
          ? 'sendblue_operation_failed'
          : String(parsed.data.error_code),
      raw,
    },
  );
}

/** Creates a Sendblue API v2 provider. No initialization call is required. */
export function sendblue(): SendblueProvider<false>;
export function sendblue(options: SendblueOptions<true>): SendblueProvider<true>;
export function sendblue(options: SendblueOptions<false>): SendblueProvider<false>;
export function sendblue(options: SendblueOptions<boolean>): SendblueProvider<boolean>;
export function sendblue(
  options: SendblueOptions<false> | SendblueOptions<true> | SendblueOptions<boolean> = {},
): SendblueProvider<boolean> {
  const apiKey = options.apiKey ?? process.env['SENDBLUE_API_KEY'];
  const apiSecret = options.apiSecret ?? process.env['SENDBLUE_API_SECRET'];
  const fromNumber = options.fromNumber ?? process.env['SENDBLUE_FROM_NUMBER'];
  const webhookSecret = options.webhookSecret ?? process.env['SENDBLUE_WEBHOOK_SECRET'];
  const markReadEnabled = options.markReadEnabled ?? false;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/u, '');
  const capabilities = {
    ...SENDBLUE_CAPABILITIES,
    conversations: {
      ...SENDBLUE_CAPABILITIES.conversations,
      markRead: markReadEnabled,
    },
  } as SendblueCapabilities<boolean>;

  const requireCredentials = (): { readonly apiKey: string; readonly apiSecret: string } => {
    if (apiKey === undefined || apiKey.length === 0) {
      throw new AuthenticationError('A Sendblue API key is required.', {
        provider: 'sendblue',
        code: 'missing_api_key',
      });
    }
    if (apiSecret === undefined || apiSecret.length === 0) {
      throw new AuthenticationError('A Sendblue API secret is required.', {
        provider: 'sendblue',
        code: 'missing_api_secret',
      });
    }
    return { apiKey, apiSecret };
  };

  const requireFromNumber = (): string => {
    if (fromNumber === undefined || fromNumber.length === 0) {
      throw new ValidationError('A Sendblue from number is required.', {
        provider: 'sendblue',
        code: 'missing_from_number',
      });
    }
    return requirePhone(fromNumber, 'fromNumber');
  };

  const request = async (
    path: string,
    init: RequestInit = {},
    requestOptions: { readonly send?: boolean; readonly notFoundNull?: boolean } = {},
  ): Promise<unknown | null> => {
    const credentials = requireCredentials();
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          'sb-api-key-id': credentials.apiKey,
          'sb-api-secret-key': credentials.apiSecret,
          ...(init.body === undefined || isFormData ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
      });
    } catch (cause) {
      if (requestOptions.send === true) {
        throw new AmbiguousDeliveryError(
          'The Sendblue send result is unknown; check the message status before retrying.',
          { provider: 'sendblue', code: 'ambiguous_delivery', retryable: true, raw: cause },
        );
      }
      throw new ProviderUnavailableError('Could not reach Sendblue.', {
        provider: 'sendblue',
        code: 'provider_unavailable',
        retryable: true,
        raw: cause,
      });
    }

    let rawText: string;
    try {
      rawText = await response.text();
    } catch (cause) {
      if (requestOptions.send === true) {
        throw new AmbiguousDeliveryError(
          'The Sendblue send result is unknown; check the message status before retrying.',
          { provider: 'sendblue', code: 'ambiguous_delivery', retryable: true, raw: cause },
        );
      }
      throw new ProviderUnavailableError('Could not read the Sendblue response.', {
        provider: 'sendblue',
        code: 'provider_unavailable',
        retryable: true,
        raw: cause,
      });
    }
    let raw: unknown;
    try {
      raw = rawText.length === 0 ? undefined : JSON.parse(rawText);
    } catch {
      raw = rawText;
    }
    if (response.ok) return raw ?? {};
    if (response.status === 404 && requestOptions.notFoundNull === true) return null;

    const parsedError = ApiErrorSchema.safeParse(raw);
    const body = parsedError.success ? parsedError.data : undefined;
    const message =
      body?.message ??
      body?.error_message ??
      body?.error ??
      `Sendblue request failed with HTTP ${response.status}.`;
    const code =
      body?.error_code === undefined || body.error_code === null
        ? `http_${response.status}`
        : String(body.error_code);
    const traceId = response.headers.get('x-request-id') ?? response.headers.get('x-trace-id');
    const common = {
      provider: 'sendblue',
      code,
      statusCode: response.status,
      raw,
      ...(traceId === null ? {} : { traceId }),
    } as const;

    if (requestOptions.send === true && (response.status === 408 || response.status >= 500)) {
      throw new AmbiguousDeliveryError(
        'The Sendblue send result is unknown; check the message status before retrying.',
        { ...common, retryable: true },
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError(message, common);
    }
    if (response.status === 400 || response.status === 422) {
      throw new ValidationError(message, common);
    }
    if (response.status === 404) throw new NotFoundError(message, common);
    if (response.status === 409) throw new ConflictError(message, common);
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader === null ? undefined : Number(retryAfterHeader);
      throw new RateLimitError(message, {
        ...common,
        retryable: true,
        ...(retryAfter !== undefined && Number.isFinite(retryAfter) ? { retryAfter } : {}),
      });
    }
    if (response.status >= 500) {
      throw new ProviderUnavailableError(message, { ...common, retryable: true });
    }
    throw new IMessageSDKError(message, common);
  };

  const uploadAttachment = async (attachment: IMessageAttachmentInput): Promise<string> => {
    if (attachment.source.type === 'url') return requirePublicUrl(attachment.source.url);
    const size =
      attachment.source.type === 'blob'
        ? attachment.source.data.size
        : attachment.source.data.byteLength;
    if (size > MAX_ATTACHMENT_BYTES) {
      throw new ValidationError('Sendblue attachments must not exceed 100 MB.', {
        provider: 'sendblue',
        code: 'attachment_too_large',
        raw: { size, maximum: MAX_ATTACHMENT_BYTES },
      });
    }
    const body = new FormData();
    let blob: Blob;
    if (attachment.source.type === 'blob') {
      blob =
        attachment.contentType === undefined ||
        attachment.source.data.type === attachment.contentType
          ? attachment.source.data
          : new Blob([await attachment.source.data.arrayBuffer()], {
              type: attachment.contentType,
            });
    } else {
      const bytes = Uint8Array.from(attachment.source.data);
      blob = new Blob([bytes.buffer], {
        ...(attachment.contentType === undefined ? {} : { type: attachment.contentType }),
      });
    }
    body.append('file', blob, filenameForAttachment(attachment));
    const raw = await request('/api/upload-file', { method: 'POST', body });
    const parsed = UploadResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new IMessageSDKError('Sendblue did not return an uploaded media URL.', {
        provider: 'sendblue',
        code: 'invalid_upload_response',
        raw,
      });
    }
    return parsed.data.media_url;
  };

  const messages: SendblueMessages = {
    async send(input): Promise<ProviderSentMessage> {
      if (input.replyTo !== undefined) {
        throw new ValidationError('Sendblue does not document native message replies.', {
          provider: 'sendblue',
          code: 'replies_not_supported',
        });
      }
      if (input.idempotencyKey !== undefined) {
        throw new ValidationError(
          'Sendblue does not document idempotency keys for message sends.',
          {
            provider: 'sendblue',
            code: 'idempotency_not_supported',
          },
        );
      }
      if ((input.attachments?.length ?? 0) > 1) {
        throw new ValidationError('Sendblue supports one attachment per direct message.', {
          provider: 'sendblue',
          code: 'too_many_attachments',
        });
      }
      if (input.text !== undefined && input.text.length > MAX_MESSAGE_LENGTH) {
        throw new ValidationError(
          `Sendblue message text must not exceed ${MAX_MESSAGE_LENGTH} characters.`,
          {
            provider: 'sendblue',
            code: 'message_too_long',
          },
        );
      }
      const hasText = input.text !== undefined && input.text.trim().length > 0;
      if (!hasText && (input.attachments?.length ?? 0) === 0) {
        throw new ValidationError('A Sendblue message requires text or one attachment.', {
          provider: 'sendblue',
          code: 'message_content_required',
        });
      }
      const number = oneRecipient(input);
      const sender = requireFromNumber();
      const attachment = input.attachments?.[0];
      const mediaUrl = attachment === undefined ? undefined : await uploadAttachment(attachment);
      const raw = await request(
        '/api/send-message',
        {
          method: 'POST',
          body: JSON.stringify({
            number,
            from_number: sender,
            ...(hasText ? { content: input.text } : {}),
            ...(mediaUrl === undefined ? {} : { media_url: mediaUrl }),
          }),
        },
        { send: true },
      );
      const parsed = parseMessage(raw);
      if (parsed === undefined) {
        throw new AmbiguousDeliveryError(
          'Sendblue accepted the request but did not return a trackable message handle.',
          {
            provider: 'sendblue',
            code: 'ambiguous_delivery',
            retryable: true,
            raw,
          },
        );
      }
      const message = mapProviderMessage(
        { ...parsed, is_outbound: true, number, from_number: sender },
        number,
        sender,
        raw,
      );
      return {
        ...message,
        direction: 'outbound',
        attachments:
          attachment === undefined
            ? message.attachments
            : [
                {
                  kind: attachment.kind,
                  ...(mediaUrl === undefined ? {} : { url: mediaUrl }),
                  ...(attachment.filename === undefined ? {} : { filename: attachment.filename }),
                  ...(attachment.contentType === undefined
                    ? {}
                    : { contentType: attachment.contentType }),
                  raw: attachment,
                },
              ],
      };
    },

    async get(message) {
      const raw = await request(
        `/api/v2/messages/${encodeURIComponent(message.messageId)}`,
        {},
        { notFoundNull: true },
      );
      if (raw === null) return null;
      const parsed = parseMessage(raw);
      if (parsed === undefined) {
        throw new IMessageSDKError('Sendblue returned an invalid message.', {
          provider: 'sendblue',
          code: 'invalid_provider_response',
          raw,
        });
      }
      return mapProviderMessage(parsed, message.conversationId, fromNumber, raw);
    },

    async getStatus(message) {
      const raw = await request(
        `/api/v2/messages/${encodeURIComponent(message.messageId)}`,
        {},
        { notFoundNull: true },
      );
      if (raw === null) return null;
      const parsed = parseMessage(raw);
      if (parsed === undefined || parsed.status === undefined) {
        throw new IMessageSDKError('Sendblue returned an invalid message status.', {
          provider: 'sendblue',
          code: 'invalid_provider_response',
          raw,
        });
      }
      const providerStatus = parsed.status;
      const status = mapStatus(providerStatus);
      const sentAt = parseDate(parsed.date_sent);
      const deliveredAt =
        parseDate(parsed.date_delivered) ??
        (providerStatus.toUpperCase() === 'DELIVERED' ? parseDate(parsed.date_updated) : undefined);
      const error = parsed.error_message ?? parsed.error_detail ?? parsed.error_reason ?? undefined;
      return {
        messageId: parsed.message_handle,
        conversationId: contactNumber(parsed, message.conversationId),
        status,
        providerStatus,
        service: parsed.was_downgraded === true ? 'sms' : mapService(parsed.service),
        ...(sentAt === undefined ? {} : { sentAt }),
        ...(deliveredAt === undefined ? {} : { deliveredAt }),
        ...(error === undefined ? {} : { error }),
        raw,
      };
    },
  };

  const openConversation = async (input: OpenConversationInput): Promise<ProviderConversation> => {
    if (input.participants.length !== 1 || input.participants[0]?.kind !== 'phone') {
      throw new ValidationError('Sendblue supports direct phone conversations only.', {
        provider: 'sendblue',
        code: 'direct_phone_conversation_required',
      });
    }
    const number = requirePhone(input.participants[0].value, 'participants[0]');
    return {
      providerConversationId: number,
      participants: [address(number)],
      raw: { number, resolved: false },
    };
  };

  const markRead = async (conversationId: string): Promise<void> => {
    const raw = await request('/api/mark-read', {
      method: 'POST',
      body: JSON.stringify({
        number: requirePhone(conversationId, 'conversationId'),
        from_number: requireFromNumber(),
      }),
    });
    assertOperationSucceeded(raw, 'mark-read request');
  };

  const conversations = {
    open: openConversation,
    ...(markReadEnabled ? { markRead } : {}),
  } as SendblueConversations<boolean>;

  const typing = async (conversationId: string, state: 'start' | 'stop'): Promise<void> => {
    const raw = await request('/api/send-typing-indicator', {
      method: 'POST',
      body: JSON.stringify({
        number: requirePhone(conversationId, 'conversationId'),
        from_number: requireFromNumber(),
        state,
      }),
    });
    assertOperationSucceeded(raw, 'typing indicator');
  };

  return defineProvider({
    name: 'sendblue',
    capabilities,
    messages,
    conversations,
    typing: {
      async start(conversationId) {
        await typing(conversationId, 'start');
      },
      async stop(conversationId) {
        await typing(conversationId, 'stop');
      },
    },
    webhooks: {
      async verify(webhookRequest) {
        if (webhookSecret === undefined || webhookSecret.length === 0) return false;
        const supplied = webhookRequest.headers.get('sb-signing-secret');
        return supplied !== null && constantTimeEqual(webhookSecret, supplied);
      },
      async parse(webhookRequest) {
        let body: unknown;
        try {
          body = await webhookRequest.json();
        } catch {
          return [];
        }
        const configuredLine = requireFromNumber();
        const values = Array.isArray(body) ? body : [body];
        return values.flatMap((value): ProviderEvent[] => {
          const typingEvent = TypingWebhookSchema.safeParse(value);
          if (typingEvent.success) {
            const event = typingEvent.data;
            if (event.from_number !== configuredLine) return [];
            const timestamp = parseDate(event.timestamp) ?? new Date();
            return [
              {
                id: `sendblue:typing:${event.number}:${event.is_typing ? 'start' : 'stop'}:${timestamp.valueOf()}`,
                type: event.is_typing ? 'typing.started' : 'typing.stopped',
                timestamp,
                conversationId: event.number,
                actor: address(event.number),
                raw: value,
              },
            ];
          }
          const message = parseMessage(value);
          if (message === undefined) return [];
          const line = webhookLine(message);
          if (line !== configuredLine) return [];
          const event = mapWebhookMessage(message, value);
          return event === undefined ? [] : [event];
        });
      },
    },
    tapbacks: {
      async add(input) {
        requirePhone(input.conversationId, 'conversationId');
        if (
          input.partIndex !== undefined &&
          (!Number.isInteger(input.partIndex) || input.partIndex < 0)
        ) {
          throw new ValidationError('Sendblue tapback partIndex must be a non-negative integer.', {
            provider: 'sendblue',
            code: 'invalid_part_index',
          });
        }
        const raw = await request('/api/send-reaction', {
          method: 'POST',
          body: JSON.stringify({
            from_number: requireFromNumber(),
            message_handle: input.messageId,
            reaction: input.reaction,
            ...(input.partIndex === undefined ? {} : { part_index: input.partIndex }),
          }),
        });
        assertOperationSucceeded(raw, 'tapback');
      },
    },
  });
}
