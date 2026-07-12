import {
  ClientClosedError,
  UnsupportedCapabilityError,
  ValidationError,
  WebhookVerificationError,
} from "./errors.js";
import type { IMessageEvent, ProviderEvent } from "./events.js";
import type { AnyIMessageProvider } from "./provider.js";
import type {
  AddReactionInput,
  Conversation,
  EditMessageInput,
  IMessageProviderName,
  Message,
  OpenConversationInput,
  ProviderConversation,
  ProviderMessage,
  RemoveReactionInput,
  SendMessageInput,
  SentMessage,
  SubscribeOptions,
} from "./types.js";

type ProviderNameOf<TProvider extends AnyIMessageProvider> = TProvider["name"];

export type ClientProvider<TProvider extends AnyIMessageProvider> = TProvider;

export type ClientProviders<TProvider extends AnyIMessageProvider> = {
  readonly [TName in TProvider["name"]]: ClientProvider<
    Extract<TProvider, { readonly name: TName }>
  >;
};

export interface IMessageClient<
  TProvider extends AnyIMessageProvider = AnyIMessageProvider,
  TConnectionId extends string = string,
> {
  readonly provider: ProviderNameOf<TProvider>;
  readonly connectionId: TConnectionId;
  readonly capabilities: TProvider["capabilities"];
  readonly providers: ClientProviders<TProvider>;

  readonly messages: {
    send(
      input: SendMessageInput,
    ): Promise<SentMessage<ProviderNameOf<TProvider>, TConnectionId>>;
    get(
      messageId: string,
    ): Promise<Message<ProviderNameOf<TProvider>, TConnectionId> | null>;
    edit(
      messageId: string,
      input: EditMessageInput,
    ): Promise<Message<ProviderNameOf<TProvider>, TConnectionId>>;
    delete(messageId: string): Promise<void>;
  };

  readonly conversations: {
    open(
      input: OpenConversationInput,
    ): Promise<Conversation<ProviderNameOf<TProvider>, TConnectionId>>;
    get(
      conversationId: string,
    ): Promise<Conversation<ProviderNameOf<TProvider>, TConnectionId> | null>;
  };

  readonly reactions: {
    add(input: AddReactionInput): Promise<void>;
    remove(input: RemoveReactionInput): Promise<void>;
  };

  readonly typing: {
    start(conversationId: string): Promise<void>;
    stop(conversationId: string): Promise<void>;
  };

  readonly webhooks: {
    handle(
      request: Request,
    ): Promise<
      readonly IMessageEvent<ProviderNameOf<TProvider>, TConnectionId>[]
    >;
  };

  readonly events: {
    subscribe(
      options?: SubscribeOptions,
    ): AsyncIterable<IMessageEvent<ProviderNameOf<TProvider>, TConnectionId>>;
  };

  close(): Promise<void>;
}

export interface CreateIMessageClientOptions<
  TProvider extends AnyIMessageProvider,
  TConnectionId extends string = "default",
> {
  readonly connectionId?: TConnectionId;
  readonly provider: TProvider;
}

function validateProvider(provider: AnyIMessageProvider): void {
  const capabilities = provider.capabilities;

  const requirements: readonly [boolean, unknown, string][] = [
    [capabilities.messages.get, provider.messages.get, "messages.get"],
    [capabilities.messages.edit, provider.messages.edit, "messages.edit"],
    [capabilities.messages.delete, provider.messages.delete, "messages.delete"],
    [
      capabilities.conversations.get,
      provider.conversations.get,
      "conversations.get",
    ],
    [capabilities.interactions.reactions, provider.reactions, "reactions"],
    [capabilities.interactions.typingStart, provider.typing, "typing.start"],
    [
      capabilities.interactions.typingStop,
      provider.typing?.stop,
      "typing.stop",
    ],
    [capabilities.events.webhooks, provider.webhooks, "webhooks"],
    [capabilities.events.stream, provider.events, "events.subscribe"],
  ];

  for (const [enabled, implementation, capability] of requirements) {
    if (enabled && implementation === undefined) {
      throw new ValidationError(
        `Provider ${provider.name} declares ${capability} but does not implement it.`,
        { provider: provider.name, code: "invalid_provider_contract" },
      );
    }
  }
}

function decorateMessage<
  TProvider extends IMessageProviderName,
  TConnectionId extends string,
>(
  message: ProviderMessage,
  provider: TProvider,
  connectionId: TConnectionId,
): Message<TProvider, TConnectionId> {
  return {
    ...message,
    id: message.providerMessageId,
    provider,
    connectionId,
  };
}

function decorateConversation<
  TProvider extends IMessageProviderName,
  TConnectionId extends string,
>(
  conversation: ProviderConversation,
  provider: TProvider,
  connectionId: TConnectionId,
): Conversation<TProvider, TConnectionId> {
  return {
    ...conversation,
    id: conversation.providerConversationId,
    provider,
    connectionId,
  };
}

function decorateEvent<
  TProvider extends IMessageProviderName,
  TConnectionId extends string,
>(
  event: ProviderEvent,
  provider: TProvider,
  connectionId: TConnectionId,
): IMessageEvent<TProvider, TConnectionId> {
  switch (event.type) {
    case "message.received":
    case "message.sent":
    case "message.delivered":
    case "message.read":
    case "message.failed":
    case "message.edited":
      return {
        ...event,
        provider,
        connectionId,
        message: decorateMessage(event.message, provider, connectionId),
      };
    case "message.deleted":
    case "reaction.added":
    case "reaction.removed":
    case "typing.started":
    case "typing.stopped":
      return { ...event, provider, connectionId };
  }
}

function mapEvents<
  TProvider extends IMessageProviderName,
  TConnectionId extends string,
>(
  events: AsyncIterable<ProviderEvent>,
  provider: TProvider,
  connectionId: TConnectionId,
): AsyncIterable<IMessageEvent<TProvider, TConnectionId>> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of events) {
        yield decorateEvent(event, provider, connectionId);
      }
    },
  };
}

export function createIMessageClient<
  const TProvider extends AnyIMessageProvider,
  const TConnectionId extends string = "default",
>(
  options: CreateIMessageClientOptions<TProvider, TConnectionId>,
): IMessageClient<TProvider, TConnectionId> {
  const { provider } = options;
  const connectionId = (options.connectionId ?? "default") as TConnectionId;

  if (connectionId.trim().length === 0) {
    throw new ValidationError("connectionId must not be empty.", {
      provider: provider.name,
      code: "invalid_connection_id",
    });
  }

  validateProvider(provider);

  let closed = false;
  let closePromise: Promise<void> | undefined;

  const errorContext = {
    provider: provider.name,
    connectionId,
  } as const;

  const assertOpen = (): void => {
    if (closed) {
      throw new ClientClosedError(errorContext);
    }
  };

  const unsupported = (capability: string): never => {
    throw new UnsupportedCapabilityError(capability, errorContext);
  };

  const requireImplementation = <T>(
    implementation: T | undefined,
    capability: string,
  ): T => {
    if (implementation === undefined) {
      throw new UnsupportedCapabilityError(capability, errorContext);
    }

    return implementation;
  };

  const providers = Object.freeze({
    [provider.name]: provider,
  }) as ClientProviders<TProvider>;

  return {
    provider: provider.name,
    connectionId,
    capabilities: provider.capabilities,
    providers,
    messages: {
      async send(input) {
        assertOpen();

        if (input.text !== undefined && !provider.capabilities.messages.text) {
          unsupported("messages.text");
        }

        if (
          input.attachments !== undefined &&
          input.attachments.length > 0 &&
          !provider.capabilities.messages.attachments
        ) {
          unsupported("messages.attachments");
        }

        if (
          input.replyTo !== undefined &&
          !provider.capabilities.messages.replies
        ) {
          unsupported("messages.replies");
        }

        if (input.to !== undefined) {
          const recipients = Array.isArray(input.to) ? input.to : [input.to];
          const isGroup = recipients.length > 1;

          if (isGroup && !provider.capabilities.conversations.groups) {
            unsupported("conversations.groups");
          }

          if (!isGroup && !provider.capabilities.conversations.direct) {
            unsupported("conversations.direct");
          }
        }

        const message = await provider.messages.send(input);
        return decorateMessage(message, provider.name, connectionId) as SentMessage<
          ProviderNameOf<TProvider>,
          TConnectionId
        >;
      },
      async get(messageId) {
        assertOpen();

        if (!provider.capabilities.messages.get) {
          unsupported("messages.get");
        }

        const get = requireImplementation(
          provider.messages.get,
          "messages.get",
        );

        const message = await get.call(provider.messages, messageId);
        return message === null
          ? null
          : decorateMessage(message, provider.name, connectionId);
      },
      async edit(messageId, input) {
        assertOpen();

        if (!provider.capabilities.messages.edit) {
          unsupported("messages.edit");
        }

        const edit = requireImplementation(
          provider.messages.edit,
          "messages.edit",
        );

        const message = await edit.call(provider.messages, messageId, input);
        return decorateMessage(message, provider.name, connectionId);
      },
      async delete(messageId) {
        assertOpen();

        if (!provider.capabilities.messages.delete) {
          unsupported("messages.delete");
        }

        const deleteMessage = requireImplementation(
          provider.messages.delete,
          "messages.delete",
        );

        await deleteMessage.call(provider.messages, messageId);
      },
    },
    conversations: {
      async open(input) {
        assertOpen();
        const isGroup = input.participants.length > 1;

        if (isGroup && !provider.capabilities.conversations.groups) {
          unsupported("conversations.groups");
        }

        if (!isGroup && !provider.capabilities.conversations.direct) {
          unsupported("conversations.direct");
        }

        const conversation = await provider.conversations.open(input);
        return decorateConversation(
          conversation,
          provider.name,
          connectionId,
        );
      },
      async get(conversationId) {
        assertOpen();

        if (!provider.capabilities.conversations.get) {
          unsupported("conversations.get");
        }

        const get = requireImplementation(
          provider.conversations.get,
          "conversations.get",
        );

        const conversation = await get.call(
          provider.conversations,
          conversationId,
        );
        return conversation === null
          ? null
          : decorateConversation(conversation, provider.name, connectionId);
      },
    },
    reactions: {
      async add(input) {
        assertOpen();

        if (!provider.capabilities.interactions.reactions) {
          unsupported("reactions.add");
        }

        const reactions = requireImplementation(
          provider.reactions,
          "reactions.add",
        );

        await reactions.add(input);
      },
      async remove(input) {
        assertOpen();

        if (!provider.capabilities.interactions.reactions) {
          unsupported("reactions.remove");
        }

        const reactions = requireImplementation(
          provider.reactions,
          "reactions.remove",
        );

        await reactions.remove(input);
      },
    },
    typing: {
      async start(conversationId) {
        assertOpen();

        if (!provider.capabilities.interactions.typingStart) {
          unsupported("typing.start");
        }

        const typing = requireImplementation(provider.typing, "typing.start");

        await typing.start(conversationId);
      },
      async stop(conversationId) {
        assertOpen();

        if (!provider.capabilities.interactions.typingStop) {
          unsupported("typing.stop");
        }

        const typing = requireImplementation(provider.typing, "typing.stop");
        const stop = requireImplementation(typing.stop, "typing.stop");

        await stop.call(typing, conversationId);
      },
    },
    webhooks: {
      async handle(request) {
        assertOpen();

        if (!provider.capabilities.events.webhooks) {
          unsupported("webhooks.handle");
        }

        const webhooks = requireImplementation(
          provider.webhooks,
          "webhooks.handle",
        );

        const verified = await webhooks.verify(request.clone());
        if (!verified) {
          throw new WebhookVerificationError(errorContext);
        }

        const events = await webhooks.parse(request);
        return events.map((event) =>
          decorateEvent(event, provider.name, connectionId),
        );
      },
    },
    events: {
      subscribe(options) {
        assertOpen();

        if (!provider.capabilities.events.stream) {
          unsupported("events.subscribe");
        }

        const events = requireImplementation(
          provider.events,
          "events.subscribe",
        );

        return mapEvents(
          events.subscribe(options),
          provider.name,
          connectionId,
        );
      },
    },
    close() {
      if (closePromise !== undefined) {
        return closePromise;
      }

      closed = true;
      closePromise = Promise.resolve().then(
        async () => await provider.close?.(),
      );
      return closePromise;
    },
  };
}
