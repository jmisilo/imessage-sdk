# Providers

Provider adapters are independently installable packages built on the public
`imessage-sdk` contract.

| Capability                    | Blooio                 | Photon Cloud                      |
| ----------------------------- | ---------------------- | --------------------------------- |
| Package                       | `@imessage-sdk/blooio` | `@imessage-sdk/photon`            |
| Send text                     | ✅                     | ✅                                |
| Send public URL attachments   | ✅                     | ✅                                |
| Send `Blob` attachments       | —                      | ✅                                |
| Send `Uint8Array` attachments | —                      | ✅                                |
| Reply to a message            | ✅                     | ✅                                |
| Get a message                 | ✅                     | ✅                                |
| Edit a message                | —                      | —                                 |
| Delete or unsend a message    | —                      | —                                 |
| Open a direct conversation    | ✅                     | ✅                                |
| Group conversations           | —                      | Experimental, provider-level only |
| Get a conversation            | ✅                     | ✅                                |
| Mark a conversation as read   | ✅                     | ✅                                |
| Add and remove reactions      | ✅                     | ✅                                |
| Start and stop typing         | ✅                     | ✅                                |
| Read receipts                 | ✅                     | ✅                                |
| Signed webhooks               | ✅                     | ✅                                |
| Normalized event stream       | —                      | —                                 |
| Provider-level event stream   | —                      | Experimental                      |
| Sender or line discovery      | Linked numbers         | Connected line                    |

`—` means the normalized v0.1 capability is unavailable. Unsupported
normalized operations throw `UnsupportedCapabilityError` rather than silently
degrading.

Photon group conversations and streaming exist behind provider-specific APIs,
but their normalized capabilities remain disabled until their behavior and
integration tests are stable enough for the v0.1 contract.

## Installation

Install the core together with exactly the providers an application uses:

```bash
pnpm add imessage-sdk @imessage-sdk/blooio
pnpm add imessage-sdk @imessage-sdk/photon
```

```ts
import { blooio } from '@imessage-sdk/blooio';
import { createIMessageClient } from 'imessage-sdk';

const client = createIMessageClient({
  provider: blooio(),
});
```

See each provider package for configuration and live integration-test details:

- [`@imessage-sdk/blooio`](./blooio)
- [`@imessage-sdk/photon`](./photon)
