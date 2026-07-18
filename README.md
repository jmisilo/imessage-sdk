# imessage-sdk

A provider-neutral TypeScript conversation layer for iMessage infrastructure.

The repository contains the provider-neutral [`imessage-sdk`](./packages/imessage-sdk)
core, independently installable providers, the
[`@imessage-sdk/chat-adapter`](./packages/chat-adapter) for
[Chat SDK](https://chat-sdk.dev), and [`imessage-cli`](./packages/cli) for local users and agents.
The core also exposes a public contract for custom providers.

## Install

```bash
pnpm add imessage-sdk @imessage-sdk/blooio
```

```ts
import { blooio } from '@imessage-sdk/blooio';
import { createIMessageClient } from 'imessage-sdk';

const client = createIMessageClient({
  provider: blooio(),
});
```

P.S. remember to create your own [Blooio account](https://app.blooio.com/signup?ref=BLOO-2NS4AJM8) and configure the provider with your credentials.

The stable v0.1 providers are Blooio, Photon, and Sendblue. See the
[provider feature matrix](./packages/providers/README.md) for their verified surfaces and current
limitations.

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
├── imessage-sdk/          Provider-neutral core package
├── providers/
│   ├── blooio/            @imessage-sdk/blooio
│   ├── photon/            @imessage-sdk/photon
│   └── sendblue/          @imessage-sdk/sendblue
├── chat-adapter/          @imessage-sdk/chat-adapter
└── cli/                   imessage-cli
examples/
└── basic-blooio/          Opt-in live Blooio API and webhook example
```

The core, provider packages, Chat SDK adapter, and CLI are independently publishable. The
repository root is private.

## CLI

The CLI bundles every official provider and supports flags, saved OS-keychain connections, stable
JSON input/output, attachments, replies, normalized operations, and an experimental Hono-based
local signed-webhook server:

```bash
npx imessage-cli send \
  --provider blooio \
  --to +15551234567 \
  --text 'Hello'
```

See the [CLI README](./packages/cli/README.md) for credential storage, agent input, provider
commands, and ngrok or Cloudflare Tunnel setup.

## Chat SDK

```bash
pnpm add @imessage-sdk/chat-adapter chat
```

```ts
import { Chat } from 'chat';

import { blooio } from '@imessage-sdk/blooio';
import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';

const imessage = createIMessageAdapter({ provider: blooio() });

const chat = new Chat({
  userName: 'my-agent',
  adapters: { imessage },
  state,
});
```

See the [adapter README](./packages/chat-adapter/README.md) for Hono webhook wiring, supported
features, thread IDs, attachments, and provider-aware typing.

## Examples

[`examples/basic-blooio`](./examples/basic-blooio) exercises the public core
and Blooio packages against a real account: conversation discovery, text,
attachments, replies, status polling, reactions, typing, read state, and
signed webhooks. It is guarded by `BLOOIO_RUN_LIVE=1` because running it sends
real messages and mutates provider state.

## Releases

Public changes use Changesets and conventional Semantic Versioning. Add a
changeset in a feature pull request with:

```bash
pnpm changeset
```

After feature changes reach `main`, automation opens or updates a **Version
Packages** pull request containing generated package versions and changelogs.
Merging that pull request verifies, builds, and publishes changed packages,
then creates package-specific Git tags and GitHub Releases, such as
`imessage-sdk@0.1.0` and `@imessage-sdk/blooio@0.1.0`.

Before publishing, the same release command used by automation also packs each
public package, runs Publint and Are the Types Wrong, installs all tarballs in
a clean strict-TypeScript consumer, checks every public import, and invokes the
installed CLI.

Stable releases publish under npm's `latest` dist-tag, while prereleases publish under `beta`. See
[RELEASING.md](./RELEASING.md) for the complete maintainer workflow.

### Release automation setup

The `Release` workflow requires:

- a `CHANGESETS_TOKEN` repository secret containing a fine-grained GitHub token
  with repository Contents and Pull requests write access;
- an `npm-production` GitHub environment;
- an npm trusted publisher for every public package, all pointing to
  `jmisilo/imessage-sdk`, `.github/workflows/release.yml`, and the
  `npm-production` environment.

A separate GitHub token is used because pull requests opened with the default
workflow token require a maintainer to approve their workflow runs. Using
`CHANGESETS_TOKEN` lets the generated Version Packages pull request receive the
normal CI and package smoke tests automatically.

### Internal package dependencies

Workspace packages import public package names, never another package's source
directory:

```ts
import { blooio } from '@imessage-sdk/blooio';
import { createIMessageClient } from 'imessage-sdk';
```

Publishable packages declare internal runtime dependencies with `workspace:^`.
pnpm links them locally and rewrites them to compatible npm ranges when packed
or published. Changesets updates dependent ranges and versions when a core
release falls outside an existing range.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

See [RELEASING.md](./RELEASING.md) for first-time npm/GitHub setup and the
regular Changesets release process.
