# imessage-sdk

A provider-neutral, type-safe TypeScript conversation layer for iMessage
infrastructure.

The normalized v0.1 client and Blooio v2 provider are implemented.

The package is ESM-only and ships JavaScript plus TypeScript declarations.

## Creating a client

Provider factories consume provider configuration and return a complete,
concrete provider:

```ts
import { createIMessageClient } from "imessage-sdk";
import { blooio } from "imessage-sdk/providers/blooio";

const client = createIMessageClient({
  provider: blooio({
    apiKey: process.env.BLOOIO_API_KEY,
    sender: { kind: "phone", value: "+15550000000" },
    webhookSecret: process.env.BLOOIO_WEBHOOK_SECRET,
  }),
});
```

`connectionId` is optional and defaults to the literal `"default"`. Supply one
when the application has multiple connections or sender lines:

```ts
const namedClient = createIMessageClient({
  connectionId: "main-line",
  provider: blooio(),
});

namedClient.connectionId;
//          ^? "main-line"
```

`blooio()` can be constructed without options for dependency wiring and type
tests, but API operations then throw a typed `AuthenticationError`.

```ts
const client = createIMessageClient({
  provider: blooio(),
});
```

The provider and connection literals are inferred through the client and its
results:

```ts
client.provider;
//    ^? "blooio"

client.connectionId;
//    ^? "default"

client.providers.blooio.name;
//                       ^? "blooio"

// @ts-expect-error Only the configured provider exists.
client.providers.photon;

const sent = await client.messages.send({
  to: { kind: "phone", value: "+15551234567" },
  text: "Hello from imessage-sdk",
});

sent.provider;
//   ^? "blooio"

sent.connectionId;
//   ^? "default"
```

## Attachments and replies

Attachments declare what they contain independently from transport. The core
model accepts URLs, `Blob`, and `Uint8Array`; Blooio v2 currently accepts only
public URLs:

```ts
await client.messages.send({
  conversationId: "provider-conversation-id",
  text: "Three attachments",
  attachments: [
    {
      kind: "image",
      source: {
        type: "url",
        url: "https://example.com/photo.jpg",
      },
      contentType: "image/jpeg",
    },
    {
      kind: "video",
      source: { type: "url", url: "https://example.com/clip.mp4" },
      filename: "clip.mp4",
    },
    {
      kind: "file",
      source: { type: "url", url: "https://example.com/document.pdf" },
      filename: "document.pdf",
    },
  ],
});
```

Replies use the provider-native message ID and optional message-part index:

```ts
await client.messages.send({
  conversationId: "provider-conversation-id",
  text: "Replying in this thread",
  replyTo: {
    messageId: "provider-message-id",
    partIndex: 0,
  },
});
```

## Provider encapsulation

Everything implemented by an adapter lives on its provider. The client exposes
the exact same instance under its typed provider namespace:

```ts
const provider = blooio();
const client = createIMessageClient({
  connectionId: "main-line",
  provider,
});

client.providers.blooio === provider; // true

await client.providers.blooio.messages.send({
  to: { kind: "phone", value: "+15551234567" },
  text: "Send directly through Blooio",
});
```

The normalized top-level methods remain available:

```ts
await client.messages.send({
  to: { kind: "phone", value: "+15551234567" },
  text: "Send through the normalized client",
});
```

They add the connection ID to results, decorate events, verify capability
support consistently, and produce normalized SDK errors.

Provider-specific methods are defined directly on the provider. Blooio exposes
its status endpoint without adding it to every adapter's normalized contract:

```ts
const status = await client.providers.blooio.messages.getStatus({
  conversationId: sent.conversationId,
  messageId: sent.providerMessageId,
});

const linkedNumbers = await client.providers.blooio.numbers.list();
```

There is no separate `extensions` object.

## Adapter implementation shape

`defineProvider()` is the generic adapter-authoring helper. It preserves the
literal name, capability values, and complete concrete provider type.

Conceptually, provider factories are structured like this:

```ts
import { defineProvider } from "imessage-sdk";

function blooio(options = {}) {
  return defineProvider({
    name: "blooio" as const,
    capabilities: BLOOIO_CAPABILITIES,
    messages: {
      async send(input) {
        return transport.send(options, input);
      },
    },
    conversations: {
      async open(input) {
        return transport.openConversation(options, input);
      },
    },
    reactions: {
      async add(input) {
        await transport.addReaction(options, input);
      },
      async remove(input) {
        await transport.removeReaction(options, input);
      },
    },
    typing: {
      async start(conversationId) {
        await transport.startTyping(options, conversationId);
      },
    },
    webhooks: {
      verify(request) {
        return transport.verifyWebhook(options, request);
      },
      parse(request) {
        return transport.parseWebhook(options, request);
      },
    },
  });
}
```

Applications use `blooio(options)`. They do not supply message, conversation,
or webhook implementations themselves.

## Custom providers

Provider names are not restricted to the built-in adapters. `defineProvider()`
preserves a user-defined provider's literal name, capabilities, and concrete
methods:

```ts
const custom = defineProvider({
  name: "my-provider" as const,
  capabilities: MY_PROVIDER_CAPABILITIES,
  messages: {
    send: sendMessage,
    get: getMessage,
    edit: editMessage,
  },
  conversations: {
    open: openConversation,
  },
});

const customClient = createIMessageClient({ provider: custom });

customClient.provider;
//           ^? "my-provider"

// Required because this concrete provider defines it as required.
await customClient.providers["my-provider"].messages.edit(
  { conversationId: "conversation-id", messageId: "message-id" },
  { text: "Corrected" },
);
```

## One provider per client

v0.1 accepts exactly one provider. When an application has multiple providers
or sender lines, it creates multiple clients and selects one explicitly:

```ts
const sales = createIMessageClient({
  connectionId: "sales-line",
  provider: blooio(salesOptions),
});

const support = createIMessageClient({
  connectionId: "support-line",
  provider: photon(supportOptions),
});
```

A multi-provider client would require explicit routing, sender ownership,
idempotency, failure, and fallback policies. If needed later, that should be a
separate router layered over multiple single-provider clients.

## Capabilities and lifecycle

The public client keeps a consistent normalized method set. Unsupported
operations throw `UnsupportedCapabilityError`, while capabilities allow runtime
feature checks:

```ts
if (client.capabilities.messages.edit) {
  await client.messages.edit(
    {
      conversationId: "provider-conversation-id",
      messageId: "provider-message-id",
    },
    { text: "Corrected" },
  );
}
```

Concrete capability values remain literal types. For example,
`client.capabilities.messages.edit` is typed as `false` for Blooio.

Providers do not have an `initialize()` hook. REST adapters are ready after
construction, while stream providers connect lazily when subscribed.

`client.close()` is always available and idempotent. It is a no-op when the
provider has no cleanup and releases resources for stream or local transports.

## Blooio operations

The v0.1 Blooio adapter supports text and public URL attachments, inline
replies, direct and group chat identifiers, message lookup and status,
reactions, typing start/stop, marking chats as read, and signed webhooks.

```ts
const locator = {
  conversationId: sent.conversationId,
  messageId: sent.providerMessageId,
};

await client.messages.get(locator);
await client.reactions.add({ ...locator, reaction: "like" });
await client.typing.start(sent.conversationId);
await client.typing.stop(sent.conversationId);
await client.conversations.markRead(sent.conversationId);
```

Webhook handling verifies `X-Blooio-Signature` before parsing and returns an
array because one provider delivery can represent zero, one, or multiple
normalized events:

```ts
const events = await client.webhooks.handle(request);
```

### Live integration test

The live test sends real messages and is disabled during normal test runs.
Set these environment variables locally:

```bash
export BLOOIO_API_KEY="..."
export BLOOIO_TEST_RECIPIENT="+15551234567"
export BLOOIO_FROM_NUMBER="+15557654321" # optional
export BLOOIO_TEST_IMAGE_URL="https://..."
export BLOOIO_TEST_VIDEO_URL="https://..."
export BLOOIO_TEST_FILE_URL="https://..."

pnpm --filter imessage-sdk test:integration:blooio
```

It sends three messages and exercises lookup/status, reactions, typing, and
mark-read. Webhook verification and parsing are covered deterministically by
the mocked test suite; a real inbound webhook requires a public test endpoint.

## v0.1 boundary

The initial model includes text, URL/blob/byte attachments, thread replies,
conversations, statuses, reactions, typing, webhooks, streams, typed
capabilities, and typed errors.

It intentionally excludes FaceTime, polls, location sharing, contacts, message
effects, scheduling, provisioning, and automatic provider fallback.
