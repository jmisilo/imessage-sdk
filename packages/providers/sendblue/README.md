# @imessage-sdk/sendblue

[Sendblue](https://www.sendblue.com/) API v2 provider for
[`imessage-sdk`](https://www.npmjs.com/package/imessage-sdk).

## Install

```bash
pnpm add imessage-sdk @imessage-sdk/sendblue
```

## Usage

```ts
import { sendblue } from '@imessage-sdk/sendblue';
import { createIMessageClient } from 'imessage-sdk';

const client = createIMessageClient({
  provider: sendblue(),
});

await client.messages.send({
  to: { kind: 'phone', value: '+15551234567' },
  text: 'Hello from Sendblue',
  attachments: [
    {
      kind: 'image',
      source: {
        type: 'url',
        url: 'https://cdn.example.com/photo.jpg',
      },
    },
  ],
});
```

`SENDBLUE_API_KEY`, `SENDBLUE_API_SECRET`, and `SENDBLUE_FROM_NUMBER` are required for API
operations. `SENDBLUE_WEBHOOK_SECRET` is additionally required when handling webhooks.
`sendblue()` reads all four variables automatically, and explicit options override environment
values. One provider instance represents one configured Sendblue line.

Sendblue currently offers a no-credit-card free sandbox with a shared line and verified-contact
restrictions, so the integration can be exercised before selecting a production plan.

## Attachments

Sendblue accepts one attachment per direct message. The provider supports images, videos, and
files from:

- a publicly accessible URL;
- a `Blob`;
- a `Uint8Array`.

URLs are passed directly to Sendblue. They must be public, unsigned HTTP(S) URLs with a usable file
extension. Blob and byte sources are uploaded through Sendblue's file upload endpoint before the
message is sent. Sendblue documents a 100 MB maximum upload size and recommends keeping attachments
below 20 MB for reliable iMessage delivery.

Inbound media is normalized as an attachment with a public Sendblue CDN URL. Sendblue documents
that inbound media URLs expire after 30 days, so applications that need longer retention should
copy the file promptly.

## Account-gated mark read

Sendblue requires the manual mark-read endpoint to be activated for the account. Enable the SDK
capability only after Sendblue confirms activation:

```ts
const client = createIMessageClient({
  provider: sendblue({ markReadEnabled: true }),
});

await client.conversations.markRead('+15551234567');
```

## Tapbacks

Sendblue currently documents adding tapbacks but not removing them, so tapbacks are exposed as a
provider-specific API rather than the normalized reactions API:

```ts
await client.providers.sendblue.tapbacks.add({
  conversationId: '+15551234567',
  messageId: 'provider-message-handle',
  reaction: 'love',
});
```

## Webhooks

Configure `receive`, `outbound`, and `typing_indicator` webhooks for the account in Sendblue, and
set the same secret as `SENDBLUE_WEBHOOK_SECRET`. The provider verifies Sendblue's
`sb-signing-secret` header, filters account-wide events to `SENDBLUE_FROM_NUMBER`, and normalizes
the accepted payloads:

```ts
const events = await client.webhooks.handle(request);
```

Inbound media is exposed through its Sendblue CDN URL. A webhook can contain both text and one
attachment, or an attachment without text.

## Current limitations

- Direct phone conversations only; normalized groups are disabled.
- One attachment per message.
- Replies, editing, native unsend, and event streams are disabled.
- Normalized reactions are disabled because Sendblue does not document tapback removal.
- Observed read-receipt events are disabled.
- Sendblue may automatically downgrade iMessage to SMS; the normalized message preserves the
  resulting service and provider status.

No operation is retried automatically. If a message send has an uncertain result, the provider
throws `AmbiguousDeliveryError` so callers can inspect status before deciding whether to retry.

Run the opt-in live test from the repository root:

```bash
pnpm --filter @imessage-sdk/sendblue test:integration
```

The live test contacts Sendblue and sends real messages. Before running it, send a fresh iMessage
from `SENDBLUE_TEST_RECIPIENT` to `SENDBLUE_FROM_NUMBER`. The suite discovers that inbound message,
adds a `like` tapback first, then exercises text plus separate image, video, and file messages.

Set `SENDBLUE_TEST_MARK_READ=1` only if Sendblue has activated manual mark-read for the test account.
When enabled, the suite marks the fresh inbound conversation as read before sending the outbound
fixtures.
