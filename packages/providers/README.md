# Providers

Provider adapters are independently installable packages built on the public
`imessage-sdk` contract.

| Capability                    | Blooio                 | Photon Cloud                      | Sendblue                 |
| ----------------------------- | ---------------------- | --------------------------------- | ------------------------ |
| Package                       | `@imessage-sdk/blooio` | `@imessage-sdk/photon`            | `@imessage-sdk/sendblue` |
| Send text                     | ✅                     | ✅                                | ✅                       |
| Send public URL attachments   | ✅                     | ✅                                | ✅ (one per message)     |
| Send `Blob` attachments       | —                      | ✅                                | ✅ (one per message)     |
| Send `Uint8Array` attachments | —                      | ✅                                | ✅ (one per message)     |
| Access inbound attachments    | Public URL             | Authenticated byte download       | Expiring public URL      |
| Reply to a message            | ✅                     | ✅                                | —                        |
| Get a message                 | ✅                     | ✅                                | ✅                       |
| Edit a message                | —                      | —                                 | —                        |
| Delete or unsend a message    | —                      | —                                 | —                        |
| Open a direct conversation    | ✅                     | ✅                                | ✅                       |
| Group conversations           | —                      | Experimental, provider-level only | —                        |
| Get a conversation            | ✅                     | ✅                                | —                        |
| Mark a conversation as read   | ✅                     | ✅                                | Account-dependent        |
| Add and remove reactions      | ✅                     | ✅                                | —                        |
| Provider-level tapback add    | —                      | —                                 | ✅                       |
| Start and stop typing         | ✅                     | ✅                                | ✅                       |
| Read receipts                 | ✅                     | ✅                                | —                        |
| Authenticated webhooks        | Signed                 | Signed                            | Shared-secret header     |
| Normalized event stream       | —                      | —                                 | —                        |
| Provider-level event stream   | —                      | Experimental                      | —                        |
| Sender or line discovery      | Linked numbers         | Connected line                    | Configured sender        |

`—` means the normalized v0.1 capability is unavailable. Unsupported
normalized operations throw `UnsupportedCapabilityError` rather than silently
degrading.

Photon group conversations and streaming exist behind provider-specific APIs,
but their normalized capabilities remain disabled until their behavior and
integration tests are stable enough for the v0.1 contract.

Sendblue accepts one outbound attachment per message in v0.1. Its normalized reaction capability
remains disabled because the documented API can add a tapback but cannot reliably remove one. The
add-only operation remains available through the concrete Sendblue provider. The Sendblue
mark-read endpoint depends on account support and must be explicitly enabled.

The published Blooio, Photon, and Sendblue v0.1 operations are stable. Their live integration suites
remain opt-in because they contact real provider accounts, send messages, and mutate provider state.

## Installation

Install the core together with exactly the providers an application uses:

```bash
pnpm add imessage-sdk @imessage-sdk/blooio
pnpm add imessage-sdk @imessage-sdk/photon
pnpm add imessage-sdk @imessage-sdk/sendblue
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
- [`@imessage-sdk/sendblue`](./sendblue)

For an executable end-to-end Blooio walkthrough, see
[`examples/basic-blooio`](../../examples/basic-blooio).
