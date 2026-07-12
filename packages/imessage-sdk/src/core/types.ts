/** Provider names stay literal through generics but are open to custom adapters. */
export type IMessageProviderName = string;

export type IMessageAddressKind = "phone" | "email";

export interface IMessageAddress {
  readonly kind: IMessageAddressKind;
  readonly value: string;
}

export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export type IMessageAttachmentKind = "image" | "video" | "file";

export type IMessageAttachmentSource =
  | {
      readonly type: "url";
      /** A URL that the selected provider can fetch. */
      readonly url: string;
    }
  | {
      readonly type: "blob";
      readonly data: Blob;
    }
  | {
      readonly type: "bytes";
      readonly data: Uint8Array;
    };

export interface IMessageAttachmentInput {
  readonly kind: IMessageAttachmentKind;
  readonly source: IMessageAttachmentSource;
  readonly filename?: string;
  readonly contentType?: string;
}

export interface IMessageAttachment {
  readonly kind: IMessageAttachmentKind;
  readonly id?: string;
  readonly url?: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly raw: unknown;
}

export interface MessageReplyReference {
  /** Provider-native message identifier. */
  readonly messageId: string;
  readonly partIndex?: number;
}

/** Identifies a provider message within its native conversation. */
export interface MessageLocator {
  readonly conversationId: string;
  readonly messageId: string;
}

type SendDestination =
  | {
      readonly conversationId: string;
      readonly to?: never;
    }
  | {
      readonly conversationId?: never;
      readonly to:
        | IMessageAddress
        | NonEmptyReadonlyArray<IMessageAddress>;
    };

type SendContent =
  | {
      readonly text: string;
      readonly attachments?: readonly IMessageAttachmentInput[];
    }
  | {
      readonly text?: string;
      readonly attachments: NonEmptyReadonlyArray<IMessageAttachmentInput>;
    };

export type SendMessageInput = SendDestination &
  SendContent & {
    readonly replyTo?: MessageReplyReference;
    readonly idempotencyKey?: string;
    readonly metadata?: Readonly<Record<string, string>>;
  };

export interface EditMessageInput {
  readonly text: string;
}

export type IMessageDirection = "inbound" | "outbound";

export type IMessageService = "imessage" | "sms" | "rcs" | "unknown";

export type IMessageStatus =
  | "pending"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/**
 * A provider-normalized message before the client adds connection identity.
 * Provider adapters return this shape.
 */
export interface ProviderMessage {
  readonly providerMessageId: string;
  /** Opaque provider-native ID, scoped to one provider connection. */
  readonly conversationId?: string;
  readonly direction: IMessageDirection;
  readonly sender: IMessageAddress;
  readonly recipients: readonly IMessageAddress[];
  readonly text: string;
  readonly attachments: readonly IMessageAttachment[];
  readonly replyTo?: MessageReplyReference;
  readonly service: IMessageService;
  readonly status: IMessageStatus;
  readonly providerStatus?: string;
  readonly createdAt: Date;
  readonly sentAt?: Date;
  readonly deliveredAt?: Date;
  readonly readAt?: Date;
  readonly raw: unknown;
}

export type ProviderSentMessage = ProviderMessage & {
  readonly direction: "outbound";
};

/** A message returned by a client bound to one provider connection. */
export type Message<
  TProvider extends IMessageProviderName = IMessageProviderName,
  TConnectionId extends string = string,
> = Omit<ProviderMessage, "conversationId"> & {
  /** Equal to providerMessageId in v0.1. */
  readonly id: string;
  /** Provider-native when available; otherwise a non-routable imsg-sdk-v1 fallback. */
  readonly conversationId: string;
  readonly provider: TProvider;
  readonly connectionId: TConnectionId;
};

export type SentMessage<
  TProvider extends IMessageProviderName = IMessageProviderName,
  TConnectionId extends string = string,
> = Message<TProvider, TConnectionId> & {
  readonly direction: "outbound";
};

export interface OpenConversationInput {
  readonly participants: NonEmptyReadonlyArray<IMessageAddress>;
}

export interface ProviderConversation {
  /** Opaque provider-native ID, scoped to one provider connection. */
  readonly providerConversationId: string;
  readonly participants: readonly IMessageAddress[];
  readonly createdAt?: Date;
  readonly raw: unknown;
}

export type Conversation<
  TProvider extends IMessageProviderName = IMessageProviderName,
  TConnectionId extends string = string,
> = ProviderConversation & {
  /** Equal to providerConversationId in v0.1; scope with provider and connectionId. */
  readonly id: string;
  readonly provider: TProvider;
  readonly connectionId: TConnectionId;
};

export type IMessageReaction =
  | "love"
  | "like"
  | "dislike"
  | "laugh"
  | "emphasize"
  | "question";

export interface AddReactionInput extends MessageLocator {
  readonly reaction: IMessageReaction;
  readonly partIndex?: number;
}

export type RemoveReactionInput = AddReactionInput;

export interface SubscribeOptions {
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}
