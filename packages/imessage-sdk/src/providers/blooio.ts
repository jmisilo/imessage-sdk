import { IMessageSDKError } from "../core/errors.js";
import { defineProvider } from "../core/provider.js";
import type {
  IMessageProvider,
  ProviderReactions,
  ProviderTyping,
  ProviderWebhooks,
} from "../core/provider.js";
import type { IMessageAddress } from "../core/types.js";

export const BLOOIO_CAPABILITIES = {
  messages: {
    text: true,
    attachments: true,
    replies: true,
    get: false,
    edit: false,
    delete: false,
  },
  conversations: {
    direct: true,
    groups: false,
    get: false,
  },
  interactions: {
    reactions: true,
    typingStart: true,
    typingStop: false,
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

export interface BlooioProvider
  extends IMessageProvider<"blooio", typeof BLOOIO_CAPABILITIES> {
  readonly reactions: ProviderReactions;
  readonly typing: ProviderTyping;
  readonly webhooks: ProviderWebhooks;
}

function notImplemented(operation: string): never {
  throw new IMessageSDKError(
    `Blooio ${operation} is not implemented in the current SDK scaffold.`,
    {
      provider: "blooio",
      code: "provider_not_implemented",
    },
  );
}

/**
 * Creates a complete Blooio provider from consumer configuration.
 *
 * The operation bodies are encapsulated here. They currently fail explicitly
 * until the stable Blooio HTTP transport is implemented.
 */
export function blooio(options: BlooioOptions = {}): BlooioProvider {
  void options;

  return defineProvider({
    name: "blooio",
    capabilities: BLOOIO_CAPABILITIES,
    messages: {
      async send() {
        return notImplemented("messages.send");
      },
    },
    conversations: {
      async open() {
        return notImplemented("conversations.open");
      },
    },
    reactions: {
      async add() {
        notImplemented("reactions.add");
      },
      async remove() {
        notImplemented("reactions.remove");
      },
    },
    typing: {
      async start() {
        notImplemented("typing.start");
      },
    },
    webhooks: {
      async verify() {
        return notImplemented("webhooks.verify");
      },
      async parse() {
        return notImplemented("webhooks.parse");
      },
    },
  });
}
