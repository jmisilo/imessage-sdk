import type {
  IMessageAddress,
  IMessageProviderName,
  IMessageReaction,
  Message,
  ProviderMessage,
} from "./types.js";

export interface ProviderEventBase<TType extends string> {
  readonly id: string;
  readonly providerEventId?: string;
  readonly type: TType;
  readonly timestamp: Date;
  readonly raw: unknown;
}

export type ProviderMessageEventType =
  | "message.received"
  | "message.sent"
  | "message.delivered"
  | "message.read"
  | "message.failed"
  | "message.edited";

export interface ProviderMessageEvent<
  TType extends ProviderMessageEventType = ProviderMessageEventType,
> extends ProviderEventBase<TType> {
  readonly message: ProviderMessage;
}

export interface ProviderMessageDeletedEvent
  extends ProviderEventBase<"message.deleted"> {
  readonly conversationId: string;
  readonly messageId: string;
}

export type ProviderReactionEventType = "reaction.added" | "reaction.removed";

export interface ProviderReactionEvent<
  TType extends ProviderReactionEventType = ProviderReactionEventType,
> extends ProviderEventBase<TType> {
  readonly conversationId: string;
  readonly messageId: string;
  readonly actor: IMessageAddress;
  readonly reaction: IMessageReaction;
  readonly partIndex?: number;
}

export type ProviderTypingEventType = "typing.started" | "typing.stopped";

export interface ProviderTypingEvent<
  TType extends ProviderTypingEventType = ProviderTypingEventType,
> extends ProviderEventBase<TType> {
  readonly conversationId: string;
  readonly actor: IMessageAddress;
}

export type ProviderEvent =
  | ProviderMessageEvent
  | ProviderMessageDeletedEvent
  | ProviderReactionEvent
  | ProviderTypingEvent;

export interface IMessageEventBase<
  TProvider extends IMessageProviderName,
  TConnectionId extends string,
  TType extends string,
> extends ProviderEventBase<TType> {
  readonly provider: TProvider;
  readonly connectionId: TConnectionId;
}

export interface IMessageMessageEvent<
  TProvider extends IMessageProviderName,
  TConnectionId extends string,
  TType extends ProviderMessageEventType = ProviderMessageEventType,
> extends IMessageEventBase<TProvider, TConnectionId, TType> {
  readonly message: Message<TProvider, TConnectionId>;
}

export interface IMessageDeletedEvent<
  TProvider extends IMessageProviderName,
  TConnectionId extends string,
> extends IMessageEventBase<TProvider, TConnectionId, "message.deleted"> {
  readonly conversationId: string;
  readonly messageId: string;
}

export interface IMessageReactionEvent<
  TProvider extends IMessageProviderName,
  TConnectionId extends string,
  TType extends ProviderReactionEventType = ProviderReactionEventType,
> extends IMessageEventBase<TProvider, TConnectionId, TType> {
  readonly conversationId: string;
  readonly messageId: string;
  readonly actor: IMessageAddress;
  readonly reaction: IMessageReaction;
  readonly partIndex?: number;
}

export interface IMessageTypingEvent<
  TProvider extends IMessageProviderName,
  TConnectionId extends string,
  TType extends ProviderTypingEventType = ProviderTypingEventType,
> extends IMessageEventBase<TProvider, TConnectionId, TType> {
  readonly conversationId: string;
  readonly actor: IMessageAddress;
}

export type IMessageEvent<
  TProvider extends IMessageProviderName = IMessageProviderName,
  TConnectionId extends string = string,
> =
  | IMessageMessageEvent<TProvider, TConnectionId>
  | IMessageDeletedEvent<TProvider, TConnectionId>
  | IMessageReactionEvent<TProvider, TConnectionId>
  | IMessageTypingEvent<TProvider, TConnectionId>;

