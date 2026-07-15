# Releasing

This repository uses independent package versions, Changesets release pull
requests, npm trusted publishing, and package-specific GitHub Releases.

## What is published

| Directory                   | npm package                  | Status              |
| --------------------------- | ---------------------------- | ------------------- |
| `packages/imessage-sdk`     | `imessage-sdk`               | Public              |
| `packages/providers/blooio` | `@imessage-sdk/blooio`       | Public              |
| `packages/providers/photon` | `@imessage-sdk/photon`       | Public              |
| `packages/chat-adapter`     | `@imessage-sdk/chat-adapter` | Public              |
| `packages/eve-channel`      | `@imessage-sdk/eve-channel`  | Private placeholder |
| `packages/cli`              | `@imessage-sdk/cli`          | Private placeholder |

## One-time local setup

Install the declared Node.js and pnpm versions, then install dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Local npm authentication is needed only when claiming a brand-new package name
before its trusted publisher can be configured:

```bash
npm login
npm whoami
```

Normal releases run in GitHub Actions through OIDC and need neither a local
`NPM_TOKEN` nor a repository npm token.

## One-time npm setup

1. Create or confirm ownership of the `imessage-sdk` npm organization.
2. Keep prereleases on the `beta` dist-tag.
3. Bootstrap a new package name manually before configuring OIDC for it.
4. Configure trusted publishing separately for every public package.

The initial prereleases currently own `latest` as a consequence of package
bootstrap. The first stable release will replace it with `0.1.0`; no dist-tag
removal is required.

## One-time GitHub setup

### Changesets token

Create a fine-grained GitHub personal access token or GitHub App token with
access to this repository and these permissions:

- Contents: read and write
- Pull requests: read and write

Store it under:

```text
Repository Settings
→ Secrets and variables
→ Actions
→ New repository secret
→ CHANGESETS_TOKEN
```

The dedicated token lets the generated Version Packages pull request run CI
without manual workflow approval.

### npm environment

Create this GitHub environment:

```text
Repository Settings
→ Environments
→ New environment
→ npm-production
```

The current combined version-or-publish workflow uses this environment on
every push to `main`. Adding required reviewers therefore pauses both Version
Packages PR creation and actual publication. Leave it without required
reviewers initially unless that extra approval on every main push is desired.

### Branch protection

Protect `main`, require pull requests, and require these CI checks:

- Node.js 20
- Node.js 22
- Node.js 24
- Package smoke test
- Verify changeset

The changeset check is intentionally skipped for `changeset-release/*`
branches because those files have already been converted into versions and
changelogs.

## Trusted publishing on npm

Configure trusted publishing separately in the settings for `imessage-sdk`,
`@imessage-sdk/blooio`, `@imessage-sdk/photon`, and `@imessage-sdk/chat-adapter`:

```text
Provider: GitHub Actions
Organization or user: jmisilo
Repository: imessage-sdk
Workflow filename: release.yml
Environment: npm-production
Allowed action: npm publish
```

For the existing core package, replace the old `publish.yml` trusted publisher
configuration. Provider trusted publishing can only be configured after each
provider package has been bootstrapped on npm.

The release workflow pins Node.js 24 and installs npm 11 before publishing so
the npm CLI supports OIDC trusted publishing.

After the first automated release succeeds, npm recommends requiring 2FA and
disallowing traditional tokens in each package’s publishing-access settings.

## Bootstrapping a new public package

npm cannot configure a trusted publisher for a package that does not exist.
For the first version of a future provider or adapter:

1. Merge its package and changeset through the normal reviewed PR flow.
2. Build and pack it from the exact `main` commit that will be tagged.
3. Inspect and publish the tarball locally under `beta`.
4. Configure that package's npm trusted publisher.
5. Backfill the matching Git tag and GitHub prerelease if automation did not
   create them.

For example:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm package:check

PACKAGE_DIR=$(mktemp -d)
pnpm --filter @imessage-sdk/<provider> pack --pack-destination "$PACKAGE_DIR"
npm publish "$PACKAGE_DIR/<tarball>.tgz" --tag beta --access public --provenance=false
```

Direct package publishing commands can incorrectly request provenance outside
GitHub Actions. Publishing the already-built tarball avoids package-manager
configuration leakage during this one-time bootstrap. All subsequent releases
use OIDC automation.

## Regular release flow

For every pull request that changes a public package:

1. Implement and verify the change.
2. Run `pnpm changeset`.
3. Select only affected public packages.
4. Choose conventional SemVer: patch for fixes, minor for compatible
   features, major for breaking changes.
5. Commit the generated `.changeset/*.md` file with the code.
6. Open and merge the pull request after CI succeeds.
7. Wait for Changesets to update the Version Packages pull request.
8. Review generated versions, changelogs, and internal dependency ranges.
9. Merge the Version Packages pull request when ready to release.
10. Verify npm and GitHub Releases after automated publication.

Do not manually edit package versions during normal releases.

## What happens during a regular release

The release automation runs after every push to `main`, but a normal feature
merge and a Version Packages merge have different effects.

### 1. A feature pull request is opened

The pull request contains the implementation and, when a public package is
affected, one or more committed `.changeset/*.md` files. CI installs the frozen
lockfile, runs linting, builds, type-checks, tests, validates the changeset, and
checks packed public packages as real consumers would install them.

Nothing is published at this stage. Package versions and npm dist-tags remain
unchanged.

### 2. The feature pull request is merged into `main`

The `Release` workflow starts because `main` received a push. Changesets sees
pending changeset files, so it opens or updates the `Version Packages` pull
request instead of publishing.

That generated pull request consumes the pending changesets and prepares:

- new versions for affected public packages;
- package changelog entries;
- compatible internal dependency range updates where required;
- removal of changeset files that have been incorporated.

Additional feature pull requests can be merged before releasing. Their
changesets are accumulated into the same Version Packages pull request.

### 3. The Version Packages pull request is reviewed

This is the release gate. Review the proposed versions, changelogs, internal
dependency ranges, and CI results. Leaving this pull request open batches more
changes; merging it authorizes publication of everything it currently contains.

Nothing has been published merely because the Version Packages pull request
exists.

### 4. The Version Packages pull request is merged

The merge creates another push to `main`, so the `Release` workflow runs again.
This time the version and changelog changes are already committed and there are
no pending changesets to turn into another release pull request. The workflow
runs `pnpm release`, which verifies the repository and asks Changesets to
publish package versions that are not yet present on npm.

The release command is self-contained: it lints, builds once, type-checks,
tests, and packs every public package. Each tarball must pass Publint, Are the
Types Wrong, strict TypeScript consumer compilation, and runtime import checks
before npm publication is invoked. Package-level `prepack` builds are omitted
so concurrent independent-package publication cannot race declaration builds.

npm authenticates the GitHub Actions job through trusted publishing with OIDC.
No repository `NPM_TOKEN` is used. Each changed package is published under the
dist-tag appropriate to the release mode:

- prerelease mode `beta` publishes versions such as `0.1.0-beta.1` under
  `beta`;
- stable releases publish under `latest`.

`scripts/publish-packages.mjs` reads `.changeset/pre.json` and explicitly
passes `--tag beta` while prerelease mode is active. It omits the tag in stable
mode, allowing npm's normal `latest` behavior. This keeps later beta cycles
from moving `latest` after a stable version exists.

Unchanged public packages are not republished.

### 5. Release metadata is created

After successful publication, the Changesets action creates package-specific
Git tags and GitHub Releases through the GitHub API. The
`CHANGESETS_TOKEN` authorizes the release pull request, commits, tags, and
GitHub Releases; OIDC separately authorizes npm publication.

For an independently versioned monorepo, a single release run can therefore
produce several tags and releases, for example:

```text
imessage-sdk@0.1.0-beta.1
@imessage-sdk/blooio@0.1.0-beta.1
```

### 6. The release is verified

Confirm that npm versions and dist-tags match the generated package versions:

```bash
npm view imessage-sdk@beta version
npm dist-tag ls imessage-sdk
npm view @imessage-sdk/blooio@beta version
npm dist-tag ls @imessage-sdk/blooio
```

Then install the release in a clean external project using `@beta` during the
prerelease period, or without a tag after a stable version owns `latest`.

Before opening a pull request, run:

```bash
pnpm format
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm package:check
pnpm changeset status
```

## Promoting a bootstrapped beta to stable

If a package was initially published with a prerelease version without entering
Changesets prerelease mode, add a normal patch Changeset for that package. For
example, a patch release from `0.1.0-beta.3` resolves to stable `0.1.0`. Review
that target in the Version Packages pull request before merging it. Stable
publication moves the package to npm’s `latest` tag.

If `.changeset/pre.json` exists because the repository is in Changesets
prerelease mode, leave that mode instead:

```bash
pnpm changeset pre exit
```

## After the first stable release

Betas are optional. Ordinary fixes and backward-compatible features use the
regular Changesets flow and publish stable patch or minor versions directly to
`latest`. A beta is not required before every stable release.

Start another beta cycle only when a change benefits from prerelease testing:

```bash
pnpm changeset pre enter beta
```

Commit the prerelease-state change through a reviewed pull request. While the
mode is active, generated versions use `-beta.N` and publish only to `beta`;
`latest` remains the last stable release. Promote the line back to stable with:

```bash
pnpm changeset pre exit
```

After that change and the generated Version Packages pull request are merged,
the stable publication updates `latest`.

## Package archive checks

`pnpm pack` creates a `.tgz` tarball: the compressed archive that npm uploads
and consumers install. It contains the built JavaScript, declarations,
metadata, README, and license—not the entire repository.

CI and the publish command check each real tarball with:

- **Publint**, which validates package metadata, exports, file inclusion, and
  JavaScript/type entry-point consistency.
- **Are the Types Wrong?**, which validates TypeScript resolution under ESM
  and bundler module-resolution modes.
- A clean TypeScript consumer that installs the tarballs, imports every public
  package, and checks provider-specific generic inference.
