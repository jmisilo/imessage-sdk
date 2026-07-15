# @imessage-sdk/blooio

[Blooio](https://app.blooio.com/signup?ref=BLOO-2NS4AJM8) v2 provider for [`imessage-sdk`](https://www.npmjs.com/package/imessage-sdk).

## Install

```bash
pnpm add imessage-sdk @imessage-sdk/blooio
```

## Usage

```ts
import { blooio } from '@imessage-sdk/blooio';
import { createIMessageClient } from 'imessage-sdk';

const client = createIMessageClient({
  provider: blooio(),
});

await client.messages.send({
  to: { kind: 'phone', value: '+15551234567' },
  text: 'Hello from Blooio',
});
```

`blooio()` reads `BLOOIO_API_KEY`, `BLOOIO_FROM_NUMBER`, and
`BLOOIO_WEBHOOK_SECRET`. Explicit options override environment values.

Message, conversation, reaction, typing, read, webhook verification, and normalized webhook event
operations are stable in v0.1.

Run the opt-in live test from the repository root:

```bash
pnpm --filter @imessage-sdk/blooio test:integration
```

See the [repository README](https://github.com/jmisilo/imessage-sdk#readme) for
capabilities, attachments, webhooks, and required live-test variables.
