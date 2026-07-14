# @imessage-sdk/photon

Photon Cloud provider for [`imessage-sdk`](https://www.npmjs.com/package/imessage-sdk).

## Install

```bash
pnpm add imessage-sdk @imessage-sdk/photon
```

## Usage

```ts
import { photon } from '@imessage-sdk/photon';
import { createIMessageClient } from 'imessage-sdk';

const client = createIMessageClient({
  provider: photon(),
});

await client.messages.send({
  to: { kind: 'phone', value: '+15551234567' },
  text: 'Hello from Photon',
});
```

`photon()` reads `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`,
`PHOTON_PHONE_NUMBER`, and `PHOTON_WEBHOOK_SECRET`. Explicit options
override environment values.

Available normalized message, conversation, reaction, typing, and read
operations are stable in v0.1. Webhook verification and event normalization
are experimental.

Run the opt-in live test from the repository root:

```bash
pnpm --filter @imessage-sdk/photon test:integration
```

See the [repository README](https://github.com/jmisilo/imessage-sdk#readme) for
capabilities, attachments, webhooks, and required live-test variables.
