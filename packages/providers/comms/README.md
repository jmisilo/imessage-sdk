# `@imessage-sdk/comms`

[Comms by Osis](https://comms.osis.co/) provider for
[`imessage-sdk`](https://www.npmjs.com/package/imessage-sdk).

## Install

```bash
pnpm add imessage-sdk @imessage-sdk/comms
```

## Send a message

Set `COMMS_API_KEY`, then create a provider:

```ts
import { comms } from '@imessage-sdk/comms';
import { createIMessageClient } from 'imessage-sdk';

const client = createIMessageClient({
  provider: comms(),
});

await client.messages.send({
  to: { kind: 'phone', value: '+15551234567' },
  text: 'Hello from Comms',
  idempotencyKey: crypto.randomUUID(),
});
```

Explicit options take precedence over environment variables:

```ts
comms({ apiKey: process.env.MY_COMMS_API_KEY });
```

## Provider-specific APIs

Documented Comms read and webhook-management APIs are available on the concrete provider:

```ts
const messages = await client.providers.comms.messages.list({
  since: new Date(Date.now() - 60_000),
  limit: 20,
});
const conversations = await client.providers.comms.conversations.list({ limit: 20 });
const contacts = await client.providers.comms.contacts.list({ limit: 20 });
const events = await client.providers.comms.deliveryEvents.list({ limit: 20 });

const endpoints = await client.providers.comms.webhookEndpoints.list();

await client.providers.comms.messages.send({
  to: { kind: 'phone', value: '+15551234567' },
  text: 'Force iMessage for this provider-specific send',
  channel: 'imessage',
});
```

Comms requires message-history reads to be bounded by either `conversationId` or `since`; the
TypeScript API enforces that requirement.

These methods require their corresponding Comms API-key scopes.

## Current support

- Direct plain-text messages
- Provider conversation continuation
- Idempotent sends
- Message, conversation, and delivery-event listing
- Contact listing and upsert
- Webhook endpoint listing and creation through the provider-specific API

Attachments, replies, group conversations, reactions, typing, read receipts, edits, deletes,
event streams, and normalized signed webhooks are disabled because they are not documented by the
current Comms API.

See the [Comms API documentation](https://docs.osis.co/messages-api/overview).
