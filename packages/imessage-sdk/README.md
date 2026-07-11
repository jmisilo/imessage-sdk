# imessage-sdk

A provider-neutral TypeScript conversation layer for iMessage infrastructure.

> This package is currently an unreleased scaffold. Provider clients and the
> normalized messaging API have not been implemented yet.

The initial provider scope is Blooio, Photon, and Sendblue. Provider-specific
entry points are reserved for future implementations:

```ts
import type { IMessageProviderName } from "imessage-sdk";
import {} from "imessage-sdk/blooio";
import {} from "imessage-sdk/photon";
import {} from "imessage-sdk/sendblue";
```

The package is ESM-only and ships JavaScript plus TypeScript declarations.

