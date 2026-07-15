# @imessage-sdk/photon

## 0.1.2

### Patch Changes

- [#22](https://github.com/jmisilo/imessage-sdk/pull/22) [`948ed20`](https://github.com/jmisilo/imessage-sdk/commit/948ed20c9758316ddeefa2586495f8a0073eb82a) Thanks [@jmisilo](https://github.com/jmisilo)! - Normalize Photon webhook messages that contain text and attachments together, and accept
  attachment metadata when Photon omits a downloadable attachment ID.

## 0.1.1

### Patch Changes

- [#15](https://github.com/jmisilo/imessage-sdk/pull/15) [`517aa7a`](https://github.com/jmisilo/imessage-sdk/commit/517aa7ae1a0df633d613ad26571aaf14cd1e1e02) Thanks [@jmisilo](https://github.com/jmisilo)! - Add provider-neutral authenticated attachment downloads and implement Photon primary-byte
  streaming.

- [#15](https://github.com/jmisilo/imessage-sdk/pull/15) [`517aa7a`](https://github.com/jmisilo/imessage-sdk/commit/517aa7ae1a0df633d613ad26571aaf14cd1e1e02) Thanks [@jmisilo](https://github.com/jmisilo)! - Promote signed webhook verification and normalized webhook events from experimental to stable.

- Updated dependencies [[`517aa7a`](https://github.com/jmisilo/imessage-sdk/commit/517aa7ae1a0df633d613ad26571aaf14cd1e1e02), [`517aa7a`](https://github.com/jmisilo/imessage-sdk/commit/517aa7ae1a0df633d613ad26571aaf14cd1e1e02)]:
  - imessage-sdk@0.1.3

## 0.1.0

### Patch Changes

- [#5](https://github.com/jmisilo/imessage-sdk/pull/5) [`802505f`](https://github.com/jmisilo/imessage-sdk/commit/802505f9876a7043af59b52afe0b15ad5fdbe620) Thanks [@jmisilo](https://github.com/jmisilo)! - Build packages once before publishing and validate the resulting tarballs with
  Publint, Are the Types Wrong, strict TypeScript compilation, and runtime import
  checks.

  Mark webhook verification and normalized webhook event APIs as experimental
  for the 0.1 release line. Other available normalized v0.1 operations are
  stable.

- [#2](https://github.com/jmisilo/imessage-sdk/pull/2) [`afbfac0`](https://github.com/jmisilo/imessage-sdk/commit/afbfac05a567a508acc9b477f1c6f02c99c2459d) Thanks [@jmisilo](https://github.com/jmisilo)! - Move Blooio and Photon into independently installable provider packages.

- Updated dependencies [[`802505f`](https://github.com/jmisilo/imessage-sdk/commit/802505f9876a7043af59b52afe0b15ad5fdbe620), [`afbfac0`](https://github.com/jmisilo/imessage-sdk/commit/afbfac05a567a508acc9b477f1c6f02c99c2459d)]:
  - imessage-sdk@0.1.0

## 0.1.0-beta.1

### Patch Changes

- [#2](https://github.com/jmisilo/imessage-sdk/pull/2) [`afbfac0`](https://github.com/jmisilo/imessage-sdk/commit/afbfac05a567a508acc9b477f1c6f02c99c2459d) Thanks [@jmisilo](https://github.com/jmisilo)! - Move Blooio and Photon into independently installable provider packages.

- Updated dependencies [[`afbfac0`](https://github.com/jmisilo/imessage-sdk/commit/afbfac05a567a508acc9b477f1c6f02c99c2459d)]:
  - imessage-sdk@0.1.0-beta.1
