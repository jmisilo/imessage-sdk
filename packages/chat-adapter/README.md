# @imessage-sdk/chat-adapter

Provider-neutral iMessage adapter for [Chat SDK](https://chat-sdk.dev), powered by
[`imessage-sdk`](https://www.npmjs.com/package/imessage-sdk).

> This package is currently in beta. Its webhook-facing API may change while normalized
> `imessage-sdk` webhooks remain experimental.

## Install

Install the adapter, Chat SDK, core SDK, state backend, and one provider:

```bash
pnpm add @imessage-sdk/chat-adapter@beta @imessage-sdk/blooio imessage-sdk chat @chat-adapter/state-pg
```

## Usage

```ts
import { createPostgresState } from '@chat-adapter/state-pg';
import { Chat } from 'chat';

import { blooio } from '@imessage-sdk/blooio';
import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';

const imessage = createIMessageAdapter({
  provider: blooio(),
});

export const chat = new Chat({
  userName: 'my-agent',
  adapters: { imessage },
  state: createPostgresState({
    url: process.env.DATABASE_URL,
  }),
});

chat.onDirectMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

The provider owns credentials and transport configuration. For Blooio, configure
`BLOOIO_API_KEY`, `BLOOIO_FROM_NUMBER`, and `BLOOIO_WEBHOOK_SECRET`, or pass the equivalent
values to `blooio()`.

The concrete provider remains available with its full type information:

```ts
imessage.client.provider;
// "blooio"

imessage.client.providers.blooio.numbers.list();
```

## Hono webhook

```ts
import { waitUntil } from '@vercel/functions';
import { Hono } from 'hono';

import { chat } from './chat.js';

const app = new Hono().post('/webhooks/imessage', (context) =>
  chat.webhooks.imessage(context.req.raw, { waitUntil }),
);

export default app;
```

Point the selected provider's signed webhook at `POST /webhooks/imessage`.

## Direct messages

Open a conversation from a phone number or email address:

```ts
const threadId = await imessage.openDM('+15551234567');
await chat.thread(threadId).post('Hello from Chat SDK');
```

Prefix an address when its kind would otherwise be ambiguous:

```ts
await imessage.openDM('phone:+15551234567');
await imessage.openDM('email:person@example.com');
```

Thread IDs are versioned and contain the provider, connection ID, and provider-native
conversation ID:

```text
imessage:v1:<base64url-json>
```

An adapter instance rejects thread IDs belonging to another provider connection.

## Attachments and formatting

Chat SDK Markdown and AST messages are rendered as plain text. Outbound Chat SDK attachment
URLs, `Blob`s, `Buffer`s, and `ArrayBuffer`s are converted into normalized SDK attachments.
The selected provider may reject source types that it cannot transport; public URLs are the
currently verified cross-provider path.

```ts
await chat.thread(threadId).post({
  markdown: '**Photo**',
  attachments: [
    {
      type: 'image',
      url: 'https://example.com/photo.jpg',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
    },
  ],
});
```

## Reactions, typing, and read state

Reactions are limited to iMessage tapbacks: `love`, `like`, `dislike`, `laugh`, `emphasize`,
and `question`. Common Chat SDK aliases such as `heart`, `thumbs_up`, and `thumbs_down` are
mapped automatically.

```ts
await imessage.addReaction(threadId, messageId, 'heart');
await imessage.startTyping(threadId);
await imessage.markRead(threadId);
```

Operations are checked against the selected provider's runtime capabilities. Chat SDK
`NotImplementedError` is thrown for unavailable normalized operations.

## Echo prevention and history

The adapter stores exact outbound provider message IDs in the configured Chat SDK state adapter
for 24 hours. This prevents provider webhook echoes from being processed as new user messages and
works across serverless instances when a persistent state adapter is used.

Set `persistThreadHistory = true` so Chat SDK stores conversation history in its state adapter.
The adapter's direct `fetchMessages()` method maintains only a bounded in-process cache because
`imessage-sdk` does not yet expose provider-neutral message-history pagination.

## v0.1 beta scope

Supported:

- One provider connection per adapter instance.
- Direct conversations.
- Inbound and outbound text.
- Attachments supported by the selected provider.
- Signed webhook verification and normalized inbound events.
- Tapback reactions.
- Typing indicators.
- Message lookup, thread metadata, and read state where supported.
- Typed access to the normalized client and concrete provider.

Postponed:

- Group conversations.
- Persistent provider event streams.
- Mentions, cards, modals, and ephemeral messages.
- Native Chat SDK response streaming.
- Provider-neutral history pagination.
- Editing and deletion for the current built-in providers.

Photon and other providers use the same adapter factory:

```ts
import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';
import { photon } from '@imessage-sdk/photon';

const imessage = createIMessageAdapter({
  provider: photon(),
});
```
