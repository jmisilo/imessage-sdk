# imessage-sdk

A provider-neutral, type-safe TypeScript conversation layer for iMessage
infrastructure.

> The normalized v0.1 contracts and client are implemented. The Blooio factory
> and its complete provider shape are in place, but its HTTP operation bodies
> are still explicit `provider_not_implemented` placeholders.

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

`blooio()` may also be constructed without options while the adapter is being
configured:

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

Attachments declare what they contain independently from how their bytes are
provided. Images, videos, and files can come from a URL, `Blob`, or
`Uint8Array`:

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
      source: { type: "blob", data: videoBlob },
      filename: "clip.mp4",
      contentType: "video/mp4",
    },
    {
      kind: "file",
      source: { type: "bytes", data: pdfBytes },
      filename: "document.pdf",
      contentType: "application/pdf",
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

Provider-specific methods will also be defined directly on the provider:

```ts
// Once implemented by the Blooio adapter:
await client.providers.blooio.getLineStatus();
```

There is no separate `extensions` object.

## Adapter implementation shape

`defineProvider()` is the generic adapter-authoring helper. It preserves the
literal name, capability values, and complete concrete provider type.

Conceptually, the Blooio implementation is structured like this:

```ts
import { defineProvider } from "imessage-sdk";

function blooio(options = {}) {
  return defineProvider({
    name: "blooio" as const,
    capabilities: BLOOIO_CAPABILITIES,
    messages: {
      async send(input) {
        return blooioTransport.send(options, input);
      },
    },
    conversations: {
      async open(input) {
        return blooioTransport.openConversation(options, input);
      },
    },
    reactions: {
      async add(input) {
        await blooioTransport.addReaction(options, input);
      },
      async remove(input) {
        await blooioTransport.removeReaction(options, input);
      },
    },
    typing: {
      async start(conversationId) {
        await blooioTransport.startTyping(options, conversationId);
      },
    },
    webhooks: {
      verify(request) {
        return blooioTransport.verifyWebhook(options, request);
      },
      parse(request) {
        return blooioTransport.parseWebhook(options, request);
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
await customClient.providers["my-provider"].messages.edit("message-id", {
  text: "Corrected",
});
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
  await client.messages.edit("provider-message-id", { text: "Corrected" });
}
```

Concrete capability values remain literal types. For example,
`client.capabilities.messages.edit` is typed as `false` for Blooio.

Providers do not have an `initialize()` hook. REST adapters are ready after
construction, while stream providers connect lazily when subscribed.

`client.close()` is always available and idempotent. It is a no-op when the
provider has no cleanup and releases resources for stream or local transports.

## v0.1 boundary

The initial model includes text, URL/blob/byte attachments, thread replies,
conversations, statuses, reactions, typing, webhooks, streams, typed
capabilities, and typed errors.

It intentionally excludes FaceTime, polls, location sharing, contacts, message
effects, scheduling, provisioning, and automatic provider fallback.
