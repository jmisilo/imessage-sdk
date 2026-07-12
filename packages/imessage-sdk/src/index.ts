export type { IMessageCapabilities } from "./core/capabilities.js";

export {
  AmbiguousDeliveryError,
  AuthenticationError,
  ClientClosedError,
  ConflictError,
  IMessageSDKError,
  NotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  UnsupportedCapabilityError,
  ValidationError,
  WebhookVerificationError,
} from "./core/errors.js";
export type { IMessageSDKErrorOptions } from "./core/errors.js";

export type {
  IMessageDeletedEvent,
  IMessageEvent,
  IMessageEventBase,
  IMessageMessageEvent,
  IMessageReactionEvent,
  IMessageTypingEvent,
  ProviderEvent,
  ProviderEventBase,
  ProviderMessageDeletedEvent,
  ProviderMessageEvent,
  ProviderMessageEventType,
  ProviderReactionEvent,
  ProviderReactionEventType,
  ProviderTypingEvent,
  ProviderTypingEventType,
} from "./core/events.js";

export { createIMessageClient } from "./core/client.js";
export type {
  ClientProvider,
  ClientProviders,
  CreateIMessageClientOptions,
  IMessageClient,
} from "./core/client.js";

export { defineProvider } from "./core/provider.js";
export type {
  AnyIMessageProvider,
  IMessageProvider,
  ProviderConversations,
  ProviderEvents,
  ProviderMessages,
  ProviderReactions,
  ProviderTyping,
  ProviderWebhooks,
} from "./core/provider.js";

export type {
  AddReactionInput,
  Conversation,
  EditMessageInput,
  IMessageAddress,
  IMessageAddressKind,
  IMessageAttachment,
  IMessageAttachmentKind,
  IMessageAttachmentInput,
  IMessageAttachmentSource,
  IMessageDirection,
  IMessageProviderName,
  IMessageReaction,
  IMessageService,
  IMessageStatus,
  Message,
  MessageLocator,
  MessageReplyReference,
  NonEmptyReadonlyArray,
  OpenConversationInput,
  ProviderConversation,
  ProviderMessage,
  ProviderSentMessage,
  RemoveReactionInput,
  SendMessageInput,
  SentMessage,
  SubscribeOptions,
} from "./core/types.js";
