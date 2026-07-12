import { z } from "zod";

import {
  AmbiguousDeliveryError,
  AuthenticationError,
  ConflictError,
  IMessageSDKError,
  NotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  ValidationError,
} from "../core/errors.js";
import type { ProviderEvent } from "../core/events.js";
import { defineProvider } from "../core/provider.js";
import type {
  IMessageProvider,
  ProviderConversations,
  ProviderMessages,
  ProviderReactions,
  ProviderTyping,
  ProviderWebhooks,
} from "../core/provider.js";
import type {
  IMessageAddress,
  IMessageAttachment,
  IMessageReaction,
  IMessageService,
  IMessageStatus,
  MessageLocator,
  OpenConversationInput,
  ProviderConversation,
  ProviderMessage,
  ProviderSentMessage,
} from "../core/types.js";

const DEFAULT_BASE_URL = "https://api.blooio.com/v2/api";
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export const BLOOIO_CAPABILITIES = {
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
    groups: true,
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

export interface BlooioOptions {
  readonly apiKey?: string;
  readonly sender?: IMessageAddress;
  readonly webhookSecret?: string;
  readonly baseUrl?: string;
}

export interface BlooioMessageStatus {
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

export type BlooioPlanKind =
  | "shared"
  | "dedicated"
  | "inbound"
  | "trial"
  | "2fa";

export interface BlooioNumber {
  readonly phoneNumber: string;
  readonly active: boolean;
  readonly lastActive?: Date;
  readonly planKind?: BlooioPlanKind;
  readonly raw: unknown;
}

export interface BlooioNumbers {
  list(): Promise<readonly BlooioNumber[]>;
}

export interface BlooioMessages extends ProviderMessages {
  get(message: MessageLocator): Promise<ProviderMessage | null>;
  getStatus(message: MessageLocator): Promise<BlooioMessageStatus | null>;
}

export interface BlooioConversations extends ProviderConversations {
  get(conversationId: string): Promise<ProviderConversation | null>;
  markRead(conversationId: string): Promise<void>;
}

export interface BlooioProvider
  extends IMessageProvider<"blooio", typeof BLOOIO_CAPABILITIES> {
  readonly messages: BlooioMessages;
  readonly conversations: BlooioConversations;
  readonly reactions: ProviderReactions;
  readonly typing: Required<ProviderTyping>;
  readonly webhooks: ProviderWebhooks;
  readonly numbers: BlooioNumbers;
}

const JsonObjectSchema = z.record(z.string(), z.unknown());
type JsonObject = z.infer<typeof JsonObjectSchema>;
const OptionalNonEmptyStringSchema = z
  .string()
  .min(1)
  .optional()
  .catch(undefined);
const OptionalNumberSchema = z.number().optional().catch(undefined);
const ReactionSchema = z.enum([
  "love",
  "like",
  "dislike",
  "laugh",
  "emphasize",
  "question",
]);
const PlanKindSchema = z.enum([
  "shared",
  "dedicated",
  "inbound",
  "trial",
  "2fa",
]);

function dateValue(value: unknown): Date | undefined {
  const number = OptionalNumberSchema.parse(value);
  if (number !== undefined) return new Date(number);
  const string = OptionalNonEmptyStringSchema.parse(value);
  if (string === undefined) return undefined;
  const date = new Date(string);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function address(value: string): IMessageAddress {
  return {
    kind: value.includes("@") ? "email" : "phone",
    value,
  };
}

function requireAddress(value: unknown, fallback = "unknown"): IMessageAddress {
  return address(OptionalNonEmptyStringSchema.parse(value) ?? fallback);
}

function mapStatus(value: unknown): IMessageStatus {
  switch (typeof value === "string" ? value.toLowerCase() : "") {
    case "queued":
    case "pending":
      return "pending";
    case "accepted":
      return "accepted";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "failed":
    case "cancelled":
    case "cancellation_requested":
    case "error":
      return "failed";
    default:
      return "pending";
  }
}

function mapService(value: unknown): IMessageService {
  switch (typeof value === "string" ? value.toLowerCase() : "") {
    case "imessage":
      return "imessage";
    case "sms":
      return "sms";
    case "rcs":
      return "rcs";
    default:
      return "unknown";
  }
}

function attachmentKind(contentType: string | undefined): IMessageAttachment["kind"] {
  if (contentType?.startsWith("image/")) return "image";
  if (contentType?.startsWith("video/")) return "video";
  return "file";
}

function mapAttachment(value: unknown): IMessageAttachment {
  if (typeof value === "string") {
    return { kind: "file", url: value, raw: value };
  }

  const parsedItem = JsonObjectSchema.safeParse(value);
  const item = parsedItem.success ? parsedItem.data : {};
  const contentType =
    OptionalNonEmptyStringSchema.parse(item["content_type"]) ??
    OptionalNonEmptyStringSchema.parse(item["contentType"]) ??
    OptionalNonEmptyStringSchema.parse(item["mime_type"]);
  const id = OptionalNonEmptyStringSchema.parse(item["id"]);
  const url = OptionalNonEmptyStringSchema.parse(item["url"]);
  const filename = OptionalNonEmptyStringSchema.parse(item["name"]);
  const size = OptionalNumberSchema.parse(item["size"]);
  const result: IMessageAttachment = {
    kind: attachmentKind(contentType),
    raw: value,
    ...(id === undefined ? {} : { id }),
    ...(url === undefined ? {} : { url }),
    ...(filename === undefined ? {} : { filename }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(size === undefined ? {} : { size }),
  };
  return result;
}

function participantValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((participant) => {
    if (typeof participant === "string") return [participant];
    const parsedParticipant = JsonObjectSchema.safeParse(participant);
    if (!parsedParticipant.success) return [];
    const identifier = OptionalNonEmptyStringSchema.parse(
      parsedParticipant.data["identifier"],
    );
    return identifier === undefined ? [] : [identifier];
  });
}

function mapProviderMessage(
  raw: JsonObject,
  fallbackConversationId: string,
  configuredSender?: IMessageAddress,
): ProviderMessage {
  const direction = raw["direction"] === "inbound" ? "inbound" : "outbound";
  const conversationId =
    OptionalNonEmptyStringSchema.parse(raw["chat_id"]) ??
    OptionalNonEmptyStringSchema.parse(raw["group_id"]) ??
    OptionalNonEmptyStringSchema.parse(raw["external_id"]) ??
    fallbackConversationId;
  const internal = OptionalNonEmptyStringSchema.parse(raw["internal_id"]);
  const parsedContact = JsonObjectSchema.safeParse(raw["contact"]);
  const external =
    OptionalNonEmptyStringSchema.parse(raw["sender"]) ??
    (parsedContact.success
      ? OptionalNonEmptyStringSchema.parse(parsedContact.data["identifier"])
      : undefined) ??
    OptionalNonEmptyStringSchema.parse(raw["external_id"]) ??
    conversationId;
  const participants = participantValues(raw["participants"]);
  const sender =
    direction === "inbound"
      ? address(external)
      : internal === undefined
        ? (configuredSender ?? address("unknown"))
        : address(internal);
  const recipients =
    direction === "inbound"
      ? [internal === undefined ? (configuredSender ?? address("unknown")) : address(internal)]
      : (participants.length > 0 ? participants : [external]).map(address);
  const providerStatus = OptionalNonEmptyStringSchema.parse(raw["status"]);
  const parsedReply = JsonObjectSchema.safeParse(raw["reply_to"]);
  const reply = parsedReply.success ? parsedReply.data : undefined;
  const replyMessageId =
    reply === undefined
      ? undefined
      : OptionalNonEmptyStringSchema.parse(reply["message_id"]) ??
        OptionalNonEmptyStringSchema.parse(reply["guid"]);
  const sentAt = dateValue(raw["time_sent"] ?? raw["sent_at"]);
  const deliveredAt = dateValue(raw["time_delivered"] ?? raw["delivered_at"]);
  const readAt = dateValue(raw["read_at"]);
  const partIndex = OptionalNumberSchema.parse(reply?.["part_index"]);

  return {
    providerMessageId:
      OptionalNonEmptyStringSchema.parse(raw["message_id"]) ??
      OptionalNonEmptyStringSchema.parse(raw["id"]) ??
      "unknown",
    conversationId,
    direction,
    sender,
    recipients,
    text: typeof raw["text"] === "string" ? raw["text"] : "",
    attachments: Array.isArray(raw["attachments"])
      ? raw["attachments"].map(mapAttachment)
      : [],
    ...(replyMessageId === undefined
      ? {}
      : {
          replyTo: {
            messageId: replyMessageId,
            ...(partIndex === undefined ? {} : { partIndex }),
          },
        }),
    service: mapService(raw["protocol"]),
    status: mapStatus(providerStatus),
    ...(providerStatus === undefined ? {} : { providerStatus }),
    createdAt:
      sentAt ?? dateValue(raw["received_at"]) ?? dateValue(raw["timestamp"]) ?? new Date(),
    ...(sentAt === undefined ? {} : { sentAt }),
    ...(deliveredAt === undefined ? {} : { deliveredAt }),
    ...(readAt === undefined ? {} : { readAt }),
    raw,
  };
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function conversationId(input: OpenConversationInput): string {
  return input.participants.map((participant) => participant.value).join(",");
}

function parseSignature(header: string):
  | { readonly timestamp: string; readonly signatures: readonly string[] }
  | undefined {
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const component of header.split(",")) {
    const separator = component.indexOf("=");
    if (separator < 0) continue;
    const key = component.slice(0, separator).trim();
    const value = component.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }
  return timestamp === undefined || signatures.length === 0
    ? undefined
    : { timestamp, signatures };
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function eventStatus(event: string, rawStatus: unknown): IMessageStatus {
  switch (event) {
    case "message.received":
      return "delivered";
    case "message.sent":
      return "sent";
    case "message.delivered":
      return "delivered";
    case "message.read":
      return "read";
    case "message.failed":
      return "failed";
    default:
      return mapStatus(rawStatus);
  }
}

function mapWebhookEvent(raw: JsonObject): ProviderEvent | undefined {
  const event = OptionalNonEmptyStringSchema.parse(raw["event"]);
  if (event === undefined) return undefined;
  const timestamp = dateValue(raw["timestamp"]) ?? new Date();
  const messageId =
    OptionalNonEmptyStringSchema.parse(raw["message_id"]) ?? "unknown";
  const conversation =
    OptionalNonEmptyStringSchema.parse(raw["group_id"]) ??
    OptionalNonEmptyStringSchema.parse(raw["external_id"]) ??
    "unknown";
  const id = `${event}:${messageId}:${timestamp.valueOf()}`;

  if (event === "message.reaction") {
    const parsedReaction = ReactionSchema.safeParse(raw["reaction"]);
    if (!parsedReaction.success) return undefined;
    const reaction = parsedReaction.data;
    const partIndex = OptionalNumberSchema.parse(raw["part_index"]);
    return {
      id,
      type: raw["action"] === "remove" ? "reaction.removed" : "reaction.added",
      timestamp,
      conversationId: conversation,
      messageId,
      actor: requireAddress(raw["sender"] ?? raw["external_id"]),
      reaction,
      ...(partIndex === undefined ? {} : { partIndex }),
      raw,
    };
  }

  if (event === "typing.started" || event === "typing.stopped") {
    const actorValue = OptionalNonEmptyStringSchema.parse(raw["sender"]);
    return {
      id,
      type: event,
      timestamp,
      conversationId: conversation,
      ...(actorValue === undefined ? {} : { actor: address(actorValue) }),
      raw,
    };
  }

  if (
    event !== "message.received" &&
    event !== "message.sent" &&
    event !== "message.delivered" &&
    event !== "message.read" &&
    event !== "message.failed"
  ) {
    return undefined;
  }

  return {
    id,
    type: event,
    timestamp,
    message: mapProviderMessage(
      { ...raw, direction: event === "message.received" ? "inbound" : "outbound", status: eventStatus(event, raw["status"]) },
      conversation,
    ),
    raw,
  };
}

/** Creates a Blooio v2 provider. No initialization call is required. */
export function blooio(options: BlooioOptions = {}): BlooioProvider {
  const apiKey = options.apiKey ?? process.env["BLOOIO_API_KEY"];
  const webhookSecret =
    options.webhookSecret ?? process.env["BLOOIO_WEBHOOK_SECRET"];
  const configuredSender = process.env["BLOOIO_FROM_NUMBER"];
  const sender =
    options.sender ??
    (configuredSender === undefined ? undefined : address(configuredSender));
  const config: BlooioOptions = {
    ...options,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(webhookSecret === undefined ? {} : { webhookSecret }),
    ...(sender === undefined ? {} : { sender }),
  };
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

  const request = async <T>(
    path: string,
    init: RequestInit = {},
    requestOptions: { readonly send?: boolean; readonly notFoundNull?: boolean } = {},
  ): Promise<T | null> => {
    if (config.apiKey === undefined || config.apiKey.length === 0) {
      throw new AuthenticationError("A Blooio API key is required.", {
        provider: "blooio",
        code: "missing_api_key",
      });
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...init.headers,
        },
      });
    } catch (cause) {
      if (requestOptions.send === true) {
        throw new AmbiguousDeliveryError(
          "The Blooio send result is unknown; retry only with the same idempotency key.",
          { provider: "blooio", code: "ambiguous_delivery", retryable: true, raw: cause },
        );
      }
      throw new ProviderUnavailableError("Could not reach Blooio.", {
        provider: "blooio",
        code: "provider_unavailable",
        retryable: true,
        raw: cause,
      });
    }

    const rawText = await response.text();
    let raw: unknown;
    try {
      raw = rawText.length === 0 ? undefined : JSON.parse(rawText);
    } catch {
      raw = rawText;
    }

    if (response.ok) return (raw ?? {}) as T;
    if (response.status === 404 && requestOptions.notFoundNull === true) return null;

    const parsedBody = JsonObjectSchema.safeParse(raw);
    const body = parsedBody.success ? parsedBody.data : {};
    const message =
      OptionalNonEmptyStringSchema.parse(body["message"]) ??
      OptionalNonEmptyStringSchema.parse(body["error"]) ??
      `Blooio request failed with HTTP ${response.status}.`;
    const code =
      OptionalNonEmptyStringSchema.parse(body["code"]) ??
      `http_${response.status}`;
    const common = {
      provider: "blooio",
      code,
      statusCode: response.status,
      raw,
    } as const;

    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError(message, common);
    }
    if (response.status === 404) throw new NotFoundError(message, common);
    if (response.status === 409) throw new ConflictError(message, common);
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter =
        retryAfterHeader === null ? undefined : Number(retryAfterHeader);
      throw new RateLimitError(message, {
        ...common,
        retryable: true,
        ...(retryAfter !== undefined && Number.isFinite(retryAfter)
          ? { retryAfter }
          : {}),
      });
    }
    if (response.status >= 500) {
      throw new ProviderUnavailableError(message, {
        ...common,
        retryable: true,
      });
    }
    throw new IMessageSDKError(message, common);
  };

  const messages: BlooioMessages = {
    async send(input): Promise<ProviderSentMessage> {
      const destinations: readonly IMessageAddress[] =
        input.to === undefined
          ? []
          : "value" in input.to
            ? [input.to]
            : input.to;
      const chatId =
        input.conversationId ??
        destinations.map((recipient) => recipient.value).join(",");
      const attachments = input.attachments?.map((attachment) => {
        if (attachment.source.type !== "url") {
          throw new ValidationError(
            "Blooio v2 requires attachments to use a publicly accessible URL.",
            { provider: "blooio", code: "attachment_url_required" },
          );
        }
        return attachment.filename === undefined
          ? attachment.source.url
          : { url: attachment.source.url, name: attachment.filename };
      });
      const body = {
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(attachments === undefined || attachments.length === 0
          ? {}
          : { attachments }),
        ...(config.sender === undefined
          ? {}
          : { from_number: config.sender.value }),
        ...(input.replyTo === undefined
          ? {}
          : {
              reply_to: {
                message_id: input.replyTo.messageId,
                ...(input.replyTo.partIndex === undefined
                  ? {}
                  : { part_index: input.replyTo.partIndex }),
              },
            }),
      };
      const raw = await request<JsonObject>(
        `/chats/${encodePath(chatId)}/messages`,
        {
          method: "POST",
          ...(input.idempotencyKey === undefined
            ? {}
            : { headers: { "idempotency-key": input.idempotencyKey } }),
          body: JSON.stringify(body),
        },
        { send: true },
      );
      const response = raw ?? {};
      const providerMessageId = OptionalNonEmptyStringSchema.parse(
        response["message_id"],
      );
      if (providerMessageId === undefined) {
        throw new IMessageSDKError("Blooio did not return a message ID.", {
          provider: "blooio",
          code: "invalid_provider_response",
          raw: response,
        });
      }
      const actualConversationId =
        OptionalNonEmptyStringSchema.parse(response["group_id"]) ?? chatId;
      const providerStatus = OptionalNonEmptyStringSchema.parse(
        response["status"],
      );
      const recipients =
        input.to === undefined
          ? participantValues(response["participants"]).map(address)
          : destinations;
      return {
        providerMessageId,
        conversationId: actualConversationId,
        direction: "outbound",
        sender: config.sender ?? address("unknown"),
        recipients,
        text: input.text ?? "",
        attachments:
          input.attachments?.map((attachment): IMessageAttachment => {
            const url =
              attachment.source.type === "url"
                ? attachment.source.url
                : undefined;
            return {
              kind: attachment.kind,
              ...(url === undefined ? {} : { url }),
              ...(attachment.filename === undefined
                ? {}
                : { filename: attachment.filename }),
              ...(attachment.contentType === undefined
                ? {}
                : { contentType: attachment.contentType }),
              raw: attachment,
            };
          }) ?? [],
        ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
        service: "imessage",
        status: mapStatus(response["status"]),
        ...(providerStatus === undefined ? {} : { providerStatus }),
        createdAt: new Date(),
        raw: response,
      };
    },

    async get(message) {
      const raw = await request<JsonObject>(
        `/chats/${encodePath(message.conversationId)}/messages/${encodePath(message.messageId)}`,
        {},
        { notFoundNull: true },
      );
      return raw === null
        ? null
        : mapProviderMessage(raw, message.conversationId, config.sender);
    },

    async getStatus(message) {
      const raw = await request<JsonObject>(
        `/chats/${encodePath(message.conversationId)}/messages/${encodePath(message.messageId)}/status`,
        {},
        { notFoundNull: true },
      );
      if (raw === null) return null;
      const providerStatus = OptionalNonEmptyStringSchema.parse(raw["status"]);
      const sentAt = dateValue(raw["time_sent"]);
      const deliveredAt = dateValue(raw["time_delivered"]);
      const error = OptionalNonEmptyStringSchema.parse(raw["error"]);
      return {
        messageId:
          OptionalNonEmptyStringSchema.parse(raw["message_id"]) ??
          message.messageId,
        conversationId:
          OptionalNonEmptyStringSchema.parse(raw["chat_id"]) ??
          message.conversationId,
        status: mapStatus(providerStatus),
        ...(providerStatus === undefined ? {} : { providerStatus }),
        service: mapService(raw["protocol"]),
        ...(sentAt === undefined ? {} : { sentAt }),
        ...(deliveredAt === undefined ? {} : { deliveredAt }),
        ...(error === undefined ? {} : { error }),
        raw,
      };
    },
  };

  const conversations: BlooioConversations = {
    async open(input) {
      const id = conversationId(input);
      return {
        providerConversationId: id,
        participants: input.participants,
        raw: { chat_id: id, resolved: false },
      };
    },

    async get(id) {
      const raw = await request<JsonObject>(
        `/chats/${encodePath(id)}`,
        {},
        { notFoundNull: true },
      );
      if (raw === null) return null;
      const participantIdentifiers = participantValues(raw["participants"]);
      const groupMembers =
        raw["is_group"] === true || id.startsWith("grp_")
          ? await request<JsonObject>(
              `/groups/${encodePath(id)}/members?limit=100`,
              {},
              { notFoundNull: true },
            )
          : null;
      const groupMemberIdentifiers =
        groupMembers === null ? [] : participantValues(groupMembers["members"]);
      const parsedContact = JsonObjectSchema.safeParse(raw["contact"]);
      const contact = parsedContact.success ? parsedContact.data : undefined;
      const contactIdentifier =
        contact === undefined
          ? undefined
          : OptionalNonEmptyStringSchema.parse(contact["identifier"]);
      const participants =
        groupMemberIdentifiers.length > 0
          ? groupMemberIdentifiers.map(address)
          : participantIdentifiers.length > 0
            ? participantIdentifiers.map(address)
          : contactIdentifier === undefined
            ? [address(OptionalNonEmptyStringSchema.parse(raw["id"]) ?? id)]
            : [address(contactIdentifier)];
      const createdAt = dateValue(raw["first_message_time"]);
      return {
        providerConversationId:
          OptionalNonEmptyStringSchema.parse(raw["id"]) ?? id,
        participants,
        ...(createdAt === undefined ? {} : { createdAt }),
        raw,
      };
    },

    async markRead(id) {
      await request(`/chats/${encodePath(id)}/read`, { method: "POST" });
    },
  };

  const react = async (
    action: "+" | "-",
    input: { readonly conversationId: string; readonly messageId: string; readonly reaction: IMessageReaction },
  ): Promise<void> => {
    await request(
      `/chats/${encodePath(input.conversationId)}/messages/${encodePath(input.messageId)}/reactions`,
      {
        method: "POST",
        body: JSON.stringify({ reaction: `${action}${input.reaction}` }),
      },
    );
  };

  return defineProvider({
    name: "blooio",
    capabilities: BLOOIO_CAPABILITIES,
    messages,
    conversations,
    reactions: {
      async add(input) {
        await react("+", input);
      },
      async remove(input) {
        await react("-", input);
      },
    },
    typing: {
      async start(id) {
        await request(`/chats/${encodePath(id)}/typing`, { method: "POST" });
      },
      async stop(id) {
        await request(`/chats/${encodePath(id)}/typing`, { method: "DELETE" });
      },
    },
    webhooks: {
      async verify(webhookRequest) {
        if (config.webhookSecret === undefined) return false;
        const header = webhookRequest.headers.get("x-blooio-signature");
        if (header === null) return false;
        const parsed = parseSignature(header);
        if (parsed === undefined) return false;
        const timestamp = Number(parsed.timestamp);
        if (!Number.isFinite(timestamp)) return false;
        const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
        if (age > DEFAULT_WEBHOOK_TOLERANCE_SECONDS) return false;
        const rawBody = await webhookRequest.text();
        const expected = await hmacSha256(
          config.webhookSecret,
          `${parsed.timestamp}.${rawBody}`,
        );
        return parsed.signatures.some((signature) =>
          constantTimeEqual(expected, signature.toLowerCase()),
        );
      },
      async parse(webhookRequest) {
        const body: unknown = await webhookRequest.json();
        const values = Array.isArray(body) ? body : [body];
        return values.flatMap((value) => {
          const parsedValue = JsonObjectSchema.safeParse(value);
          if (!parsedValue.success) return [];
          const event = mapWebhookEvent(parsedValue.data);
          return event === undefined ? [] : [event];
        });
      },
    },
    numbers: {
      async list() {
        const response = await request<JsonObject>("/me/numbers");
        const values = Array.isArray(response?.["numbers"])
          ? response["numbers"]
          : [];
        return values.flatMap((value): BlooioNumber[] => {
          const parsedValue = JsonObjectSchema.safeParse(value);
          if (!parsedValue.success) return [];
          const item = parsedValue.data;
          const phoneNumber = OptionalNonEmptyStringSchema.parse(
            item["phone_number"],
          );
          if (phoneNumber === undefined) return [];
          const lastActive = dateValue(item["last_active"]);
          const parsedPlanKind = PlanKindSchema.safeParse(item["plan_kind"]);
          return [
            {
              phoneNumber,
              active: item["is_active"] === true,
              ...(lastActive === undefined ? {} : { lastActive }),
              ...(parsedPlanKind.success
                ? { planKind: parsedPlanKind.data }
                : {}),
              raw: item,
            },
          ];
        });
      },
    },
  });
}
