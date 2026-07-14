# imessage-sdk

A provider-neutral, type-safe TypeScript conversation layer for iMessage
infrastructure.

The normalized v0.1 client is implemented here. Blooio v2 and Photon Cloud are
published as separate provider packages so applications install only the
provider dependencies they use.

The package is ESM-only and ships JavaScript plus TypeScript declarations.

> This is a beta release. Install the prerelease with `pnpm add
imessage-sdk@beta` while the public API is being validated.

## Install

```bash
pnpm add imessage-sdk@beta @imessage-sdk/blooio@beta
```

## Creating a client

Provider factories consume provider configuration and return a complete,
concrete provider:

```ts
import { blooio } from '@imessage-sdk/blooio';
import { createIMessageClient } from 'imessage-sdk';

const client = createIMessageClient({
  provider: blooio(),
});
```

Provider options override environment defaults. `blooio()` reads
`BLOOIO_API_KEY`, `BLOOIO_FROM_NUMBER`, and `BLOOIO_WEBHOOK_SECRET`.

`connectionId` is optional and defaults to the literal `"default"`. Supply one
when the application has multiple connections or sender lines:

```ts
const namedClient = createIMessageClient({
  connectionId: 'main-line',
  provider: blooio(),
});

namedClient.connectionId;
//          ^? "main-line"
```

`blooio()` can be constructed without explicit options for dependency wiring
and type tests. If neither options nor environment credentials are available,
API operations throw a typed `AuthenticationError`.

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
  to: { kind: 'phone', value: '+15551234567' },
  text: 'Hello from imessage-sdk',
});

sent.provider;
//   ^? "blooio"

sent.connectionId;
//   ^? "default"
```

## Attachments and replies

Attachments declare what they contain independently from transport. The core
model accepts URLs, `Blob`, and `Uint8Array`; Blooio v2 currently accepts only
public URLs, while Photon uploads all three source types:

```ts
await client.messages.send({
  conversationId: 'provider-conversation-id',
  text: 'Three attachments',
  attachments: [
    {
      kind: 'image',
      source: {
        type: 'url',
        url: 'https://example.com/photo.jpg',
      },
      contentType: 'image/jpeg',
    },
    {
      kind: 'video',
      source: { type: 'url', url: 'https://example.com/clip.mp4' },
      filename: 'clip.mp4',
    },
    {
      kind: 'file',
      source: { type: 'url', url: 'https://example.com/document.pdf' },
      filename: 'document.pdf',
    },
  ],
});
```

Replies use the provider-native message ID and optional message-part index:

```ts
await client.messages.send({
  conversationId: 'provider-conversation-id',
  text: 'Replying in this thread',
  replyTo: {
    messageId: 'provider-message-id',
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
  connectionId: 'main-line',
  provider,
});

client.providers.blooio === provider; // true

await client.providers.blooio.messages.send({
  to: { kind: 'phone', value: '+15551234567' },
  text: 'Send directly through Blooio',
});
```

The normalized top-level methods remain available:

```ts
await client.messages.send({
  to: { kind: 'phone', value: '+15551234567' },
  text: 'Send through the normalized client',
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
import { defineProvider } from 'imessage-sdk';

function blooio(options = {}) {
  return defineProvider({
    name: 'blooio' as const,
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
  name: 'my-provider' as const,
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
await customClient.providers['my-provider'].messages.edit(
  { conversationId: 'conversation-id', messageId: 'message-id' },
  { text: 'Corrected' },
);
```

## One provider per client

v0.1 accepts exactly one provider. When an application has multiple providers
or sender lines, it creates multiple clients and selects one explicitly:

```ts
const sales = createIMessageClient({
  connectionId: 'sales-line',
  provider: blooio(salesOptions),
});

const support = createIMessageClient({
  connectionId: 'support-line',
  provider: photon(supportOptions),
});
```

A multi-provider client would require explicit routing, sender ownership,
idempotency, failure, and fallback policies. If needed later, that should be a
separate router layered over multiple single-provider clients.

## Conversation IDs

Provider-native conversation IDs are required for provider operations and must
be treated as opaque values scoped by `provider` and `connectionId`.

If a provider message unexpectedly omits its native conversation ID, the SDK
creates a diagnostic fallback from the provider message ID and timestamp:

```text
imsg-sdk-v1-<base64url-json>
```

Fallback IDs keep normalized inbound messages structurally valid, but they are
not routable provider conversation handles. Passing one to send, lookup,
reaction, typing, or read operations throws a `ValidationError` with code
`non_routable_conversation_id`.

## Capabilities and lifecycle

The public client keeps a consistent normalized method set. Unsupported
operations throw `UnsupportedCapabilityError`, while capabilities allow runtime
feature checks:

```ts
if (client.capabilities.messages.edit) {
  await client.messages.edit(
    {
      conversationId: 'provider-conversation-id',
      messageId: 'provider-message-id',
    },
    { text: 'Corrected' },
  );
}
```

Concrete capability values remain literal types. For example,
`client.capabilities.messages.edit` is typed as `false` for Blooio.

Providers do not have an `initialize()` hook. REST adapters are ready after
construction, while stream providers connect lazily when subscribed.

`client.close()` is always available and idempotent. It is a no-op when the
provider has no cleanup and releases resources for stream or local transports.

All available normalized v0.1 operations are stable except webhook handling.
`client.webhooks`, `ProviderWebhooks`, and webhook event normalization are
marked experimental and may change incompatibly during the 0.1 release line.

## Blooio operations

The v0.1 Blooio adapter supports text and public URL attachments, inline
replies, direct conversations, message lookup and status, reactions, typing
start/stop, marking chats as read, and signed webhooks. Group conversations are
experimental at the provider level and disabled in the normalized client.

```ts
const locator = {
  conversationId: sent.conversationId,
  messageId: sent.providerMessageId,
};

await client.messages.get(locator);
await client.reactions.add({ ...locator, reaction: 'like' });
await client.typing.start(sent.conversationId);
await client.typing.stop(sent.conversationId);
await client.conversations.markRead(sent.conversationId);
```

Experimental webhook handling verifies `X-Blooio-Signature` before parsing and
returns an array because one provider delivery can represent zero, one, or
multiple normalized events:

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

pnpm --filter @imessage-sdk/blooio test:integration
```

It sends three messages and exercises lookup/status, reactions, typing, and
mark-read. Webhook verification and parsing are covered deterministically by
the mocked test suite; a real inbound webhook requires a public test endpoint.

## Photon Cloud operations

Photon authenticates with Spectrum Cloud lazily. A dedicated phone is optional
when the project owns exactly one line and required when it owns multiple:

```ts
import { photon } from '@imessage-sdk/photon';
import { createIMessageClient } from 'imessage-sdk';

const client = createIMessageClient({
  connectionId: 'photon-main',
  provider: photon(),
});

const line = await client.providers.photon.connection.getLine();
```

`photon()` reads `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`,
`PHOTON_PHONE_NUMBER`, and `PHOTON_WEBHOOK_SECRET`. Explicit options override
the environment.

The provider renews temporary line credentials internally and supports direct
chats, all attachment source types, replies, lookup, reactions, typing,
mark-read, and signed Spectrum webhooks. Normalized editing, deletion, group
conversations, and event streaming are conservatively disabled in v0.1. Their
capabilities are `false`, and normalized calls throw
`UnsupportedCapabilityError`.

Photon streaming remains available as an experimental provider-level API.
Cursors are durable numeric event sequences represented as strings:

```ts
for await (const event of client.providers.photon.events.subscribe({
  cursor: '123',
})) {
  console.log(event.providerEventId, event.type);
}

await client.close();
```

Group-conversation implementations also remain experimental at the provider
level. Normalized `client.conversations.open(...)` accepts one participant in
v0.1 and rejects multiple participants with `UnsupportedCapabilityError`.

### Photon live integration test

```bash
export PHOTON_PROJECT_ID="..."
export PHOTON_PROJECT_SECRET="..."
export PHOTON_PHONE_NUMBER="+15557654321" # optional with one line
export PHOTON_TEST_RECIPIENT="+15551234567"
export PHOTON_TEST_IMAGE_URL="https://..."
export PHOTON_TEST_VIDEO_URL="https://..."
export PHOTON_TEST_FILE_URL="https://..."

pnpm --filter @imessage-sdk/photon test:integration
```

On Photon Free and Pro shared lines, add the recipient under the project's
**Users** tab first. New contacts have a temporary reply allowance until they
have sent enough inbound messages, so use an opted-in recipient and avoid
repeated live runs against a fresh contact.

The outbound test exercises line discovery, idempotency, attachments, replies,
lookup, reactions, typing, mark-read, and cleanup. To test the experimental
persistent stream, run the command below and send an iMessage to the line
within 60 seconds:

```bash
pnpm --filter @imessage-sdk/photon test:integration:stream
```

## v0.1 beta boundary

The initial model includes text, URL/blob/byte attachments, thread replies,
direct conversations, statuses, reactions, typing, webhooks, typed
capabilities, and typed errors. Photon streams and both providers' group
implementations remain experimental provider-level APIs.

It intentionally excludes FaceTime, polls, location sharing, contacts, message
effects, scheduling, provisioning, and automatic provider fallback.

## License

MIT

Release history is tracked in the repository
[changelog](https://github.com/jmisilo/imessage-sdk/blob/main/CHANGELOG.md).
