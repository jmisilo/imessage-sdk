import type { IMessageCapabilities } from './capabilities.js';
import type { ProviderEvent } from './events.js';
import type {
  AddReactionInput,
  EditMessageInput,
  IMessageProviderName,
  MessageLocator,
  OpenConversationInput,
  ProviderConversation,
  ProviderMessage,
  ProviderSentMessage,
  RemoveReactionInput,
  SendMessageInput,
  SubscribeOptions,
} from './types.js';

export interface ProviderMessages {
  send(input: SendMessageInput): Promise<ProviderSentMessage>;
  get?(message: MessageLocator): Promise<ProviderMessage | null>;
  edit?(message: MessageLocator, input: EditMessageInput): Promise<ProviderMessage>;
  delete?(message: MessageLocator): Promise<void>;
}

export interface ProviderAttachments {
  /** Downloads one provider-native attachment into memory. */
  download(attachmentId: string): Promise<Uint8Array>;
}

export interface ProviderConversations {
  open(input: OpenConversationInput): Promise<ProviderConversation>;
  get?(conversationId: string): Promise<ProviderConversation | null>;
  markRead?(conversationId: string): Promise<void>;
}

export interface ProviderReactions {
  add(input: AddReactionInput): Promise<void>;
  remove(input: RemoveReactionInput): Promise<void>;
}

export interface ProviderTyping {
  start(conversationId: string): Promise<void>;
  stop?(conversationId: string): Promise<void>;
}

/** Provider webhook verification and normalization contract. */
export interface ProviderWebhooks {
  verify(request: Request): Promise<boolean>;
  parse(request: Request): Promise<readonly ProviderEvent[]>;
}

export interface ProviderEvents {
  subscribe(options?: SubscribeOptions): AsyncIterable<ProviderEvent>;
}

/**
 * Contract implemented by a provider adapter.
 *
 * The complete adapter is exposed at `client.providers.<name>`, so
 * provider-specific APIs should be defined directly on the concrete provider.
 */
export interface IMessageProvider<
  TName extends IMessageProviderName = IMessageProviderName,
  TCapabilities extends IMessageCapabilities = IMessageCapabilities,
> {
  readonly name: TName;
  readonly capabilities: TCapabilities;
  readonly attachments?: ProviderAttachments;
  readonly messages: ProviderMessages;
  readonly conversations: ProviderConversations;
  readonly reactions?: ProviderReactions;
  readonly typing?: ProviderTyping;
  readonly webhooks?: ProviderWebhooks;
  readonly events?: ProviderEvents;
  close?(): Promise<void>;
}

export type AnyIMessageProvider = IMessageProvider<IMessageProviderName, IMessageCapabilities>;

/** Preserves the concrete name, capabilities, and methods of an adapter. */
export function defineProvider<const TProvider extends AnyIMessageProvider>(
  provider: TProvider,
): TProvider {
  return provider;
}
