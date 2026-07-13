# Changelog

All notable changes to `imessage-sdk` will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Split Blooio and Photon from the core package into independently installable
  `@imessage-sdk/blooio` and `@imessage-sdk/photon` packages.
- Replaced the single-package tag publisher with Changesets version pull
  requests, independent package versions, and package-specific GitHub Releases.

## [0.1.0-beta.0] - 2026-07-12

Initial public beta.

### Added

- Provider-neutral, type-safe client with one provider connection per client.
- Custom provider authoring through `defineProvider()`.
- Provider-specific access through `client.providers.<provider>`.
- Normalized messages, attachments, replies, conversations, reactions, typing,
  read state, webhooks, events, capabilities, and typed SDK errors.
- URL, `Blob`, and `Uint8Array` attachment input types.
- Optional `connectionId` with a single exported default.
- Diagnostic `imsg-sdk-v1-*` fallback IDs for provider messages that omit a
  native conversation ID.
- Environment-based provider configuration with explicit option overrides.
- Blooio v2 provider with text, public URL attachments, replies, lookup/status,
  reactions, typing, read state, linked-number discovery, and signed webhooks.
- Photon Cloud provider with line discovery, renewable credentials, text,
  attachments, replies, lookup, reactions, typing, read state, and signed
  webhooks.
- Experimental provider-level Photon event streaming with cursor catch-up and
  deduplication.

### Known limitations

- Group conversations are experimental and disabled in the normalized client.
- Photon event streaming is experimental and disabled in the normalized client.
- Photon editing and native unsend are not exposed in v0.1.
- Blooio accepts public attachment URLs; binary attachment storage is not yet
  included.
- SDK-generated fallback conversation IDs are diagnostic and cannot be used for
  provider routing.
- Formatting is plain text.
- The Chat SDK adapter, Eve channel, and CLI are not implemented yet.

[Unreleased]: https://github.com/jmisilo/imessage-sdk/compare/imessage-sdk@0.1.0-beta.0...HEAD
[0.1.0-beta.0]: https://github.com/jmisilo/imessage-sdk/releases/tag/imessage-sdk@0.1.0-beta.0
