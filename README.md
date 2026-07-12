# imessage-sdk

A provider-neutral TypeScript conversation layer for iMessage infrastructure.

The repository currently publishes [`imessage-sdk`](./packages/imessage-sdk),
with built-in Blooio v2 and Photon Cloud providers and a public contract for
custom providers.

> `0.1.0-beta.0` is a prerelease. Install it with the `beta` tag while the
> public API is being validated in real applications.

## Install

```bash
pnpm add imessage-sdk@beta
```

```ts
import { createIMessageClient } from "imessage-sdk";
import { blooio } from "imessage-sdk/providers/blooio";

const client = createIMessageClient({
  provider: blooio(),
});
```

See the [package README](./packages/imessage-sdk/README.md) for the public API,
provider configuration, capability boundary, and live integration tests.

## Requirements

- Node.js 20.19+, 22.13+, or 24+
- pnpm 10.18.3

## Workspace commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Run a command for only the SDK package with pnpm filtering:

```bash
pnpm --filter imessage-sdk build
```

## Workspace layout

```text
packages/
├── imessage-sdk/     Publishable SDK package
├── chat-adapter/     Private placeholder for @imessage-sdk/chat-adapter
├── eve-channel/      Private placeholder for @imessage-sdk/eve-channel
└── cli/              Private placeholder for @imessage-sdk/cli
```

Only `packages/imessage-sdk` is publishable. The repository root and future
package placeholders are private.

## Releases

Package releases use tags in this form:

```text
imessage-sdk@0.1.0-beta.0
imessage-sdk@0.1.0
```

Pushing a matching tag runs the publish workflow. It verifies, builds, and
publishes the package when that version is absent from npm, then creates the
corresponding GitHub prerelease or stable release. If a version was published
manually, the workflow skips npm and backfills the GitHub Release.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.
