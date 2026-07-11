# imessage-sdk

A provider-neutral TypeScript conversation layer for iMessage infrastructure.

This repository is an early workspace scaffold. The first package is
[`imessage-sdk`](./packages/imessage-sdk), with provider implementations planned
for Blooio, Photon, and Sendblue. The Chat SDK adapter will be added after the
normalized public API is stable.

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
└── imessage-sdk/     Publishable SDK package
```

The workspace already includes an `examples/*` package pattern so examples can
be added later without changing the workspace configuration.
