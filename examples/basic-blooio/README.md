# Basic Blooio example

This private workspace example exercises the public `imessage-sdk` and
`@imessage-sdk/blooio` packages against a real Blooio account.

It covers:

- capability inspection;
- opening a direct conversation;
- text sending and idempotency;
- image, video, and file attachments from public URLs;
- replies;
- message and delivery-status retrieval;
- conversation retrieval and mark-read;
- typing start and stop;
- reaction add and remove;
- signed webhook verification and event parsing.

## Outbound operations

Create the local environment file:

```bash
cp examples/basic-blooio/.env.example examples/basic-blooio/.env
```

Required for outbound operations:

```dotenv
BLOOIO_RUN_LIVE=1
BLOOIO_API_KEY=your-api-key
BLOOIO_FROM_NUMBER=+15557654321
BLOOIO_TEST_RECIPIENT=+15551234567
BLOOIO_TEST_IMAGE_URL=https://example.com/image.jpg
BLOOIO_TEST_VIDEO_URL=https://example.com/video.mp4
BLOOIO_TEST_FILE_URL=https://example.com/document.pdf
```

The acknowledgement is required because the example sends real messages and
performs interactions. Run it from the repository root:

```bash
pnpm --filter @imessage-sdk/example-basic-blooio start
```

## Inbound webhooks

Webhook verification and normalized webhook events are experimental in v0.1.

The webhook example uses Hono and requires only:

```dotenv
BLOOIO_WEBHOOK_SECRET=your-webhook-secret
```

`BLOOIO_WEBHOOK_PORT` is optional and defaults to `3000`. Run:

```bash
pnpm --filter @imessage-sdk/example-basic-blooio webhook
```

Expose this route through an HTTPS tunnel and configure it in Blooio:

```text
POST /webhooks/blooio
```

The server verifies each signature through `client.webhooks.handle()`, logs the
normalized events, returns `204` for accepted payloads, and returns `401` for an
invalid signature.
