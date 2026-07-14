#!/usr/bin/env bash

set -euo pipefail

PACKAGE_DIR=$(mktemp -d)
CONSUMER_DIR=$(mktemp -d)

cleanup() {
  rm -rf "${PACKAGE_DIR}" "${CONSUMER_DIR}"
}
trap cleanup EXIT

pnpm --filter imessage-sdk pack --pack-destination "${PACKAGE_DIR}"
pnpm --filter @imessage-sdk/blooio pack --pack-destination "${PACKAGE_DIR}"
pnpm --filter @imessage-sdk/photon pack --pack-destination "${PACKAGE_DIR}"
pnpm --filter @imessage-sdk/chat-adapter pack --pack-destination "${PACKAGE_DIR}"

TARBALLS=("${PACKAGE_DIR}"/*.tgz)
for package_path in "${TARBALLS[@]}"; do
  pnpm exec publint "${package_path}" --strict
  pnpm exec attw "${package_path}" --profile esm-only
done

cp -R test/package-consumer/. "${CONSUMER_DIR}"
npm install \
  --cache "${PACKAGE_DIR}/npm-cache" \
  --prefix "${CONSUMER_DIR}" \
  "${TARBALLS[@]}" >/dev/null
pnpm exec tsc --project "${CONSUMER_DIR}/tsconfig.json"

(
  cd "${CONSUMER_DIR}"
  node --input-type=module -e '
    await import("imessage-sdk");
    await import("@imessage-sdk/blooio");
    await import("@imessage-sdk/photon");
    await import("@imessage-sdk/chat-adapter");
    await import("chat");
  '
)
