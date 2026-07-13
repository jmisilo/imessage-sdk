# Releasing

This repository uses independent package versions, Changesets release pull
requests, npm trusted publishing, and package-specific GitHub Releases.

## What is published

| Directory                   | npm package                  | Status              |
| --------------------------- | ---------------------------- | ------------------- |
| `packages/imessage-sdk`     | `imessage-sdk`               | Public              |
| `packages/providers/blooio` | `@imessage-sdk/blooio`       | Public              |
| `packages/providers/photon` | `@imessage-sdk/photon`       | Public              |
| `packages/chat-adapter`     | `@imessage-sdk/chat-adapter` | Private placeholder |
| `packages/eve-channel`      | `@imessage-sdk/eve-channel`  | Private placeholder |
| `packages/cli`              | `@imessage-sdk/cli`          | Private placeholder |

## One-time local setup

Install the declared Node.js and pnpm versions, then install dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Authenticate the npm CLI for the initial provider bootstrap and dist-tag
maintenance:

```bash
npm login
npm whoami
```

Normal automated releases use GitHub OIDC and do not require a local
`NPM_TOKEN` or a repository npm token.

## One-time npm setup

1. Create or confirm ownership of the `imessage-sdk` npm organization.
2. Keep prereleases on the `beta` dist-tag.
3. Bootstrap new provider package names manually before relying on OIDC.
4. Configure trusted publishing separately for every public package.

The existing core currently has an accidental `latest` tag pointing to a beta.
Remove it after authenticating:

```bash
npm dist-tag ls imessage-sdk
npm dist-tag rm imessage-sdk latest
npm dist-tag ls imessage-sdk
```

After the provider split reaches `main`, publish each initial provider beta:

```bash
pnpm --filter @imessage-sdk/blooio publish --tag beta --access public
pnpm --filter @imessage-sdk/photon publish --tag beta --access public
```

Verify their tags and remove `latest` if npm created it:

```bash
npm dist-tag ls @imessage-sdk/blooio
npm dist-tag ls @imessage-sdk/photon
npm dist-tag rm @imessage-sdk/blooio latest
npm dist-tag rm @imessage-sdk/photon latest
```

Only run a removal command when the corresponding `latest` tag exists.

Because these bootstrap publications are manual, backfill their Git tags and
GitHub prereleases from the exact commit used to publish:

```bash
git tag '@imessage-sdk/blooio@0.1.0-beta.0'
git tag '@imessage-sdk/photon@0.1.0-beta.0'
git push origin '@imessage-sdk/blooio@0.1.0-beta.0'
git push origin '@imessage-sdk/photon@0.1.0-beta.0'

gh release create '@imessage-sdk/blooio@0.1.0-beta.0' --prerelease --generate-notes
gh release create '@imessage-sdk/photon@0.1.0-beta.0' --prerelease --generate-notes
```

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
`@imessage-sdk/blooio`, and `@imessage-sdk/photon`:

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

## Preparing the current provider-split release

1. Authenticate npm and remove the accidental core `latest` tag.
2. Configure `CHANGESETS_TOKEN` and the `npm-production` environment.
3. Commit the provider split, release workflow, and changeset on a feature
   branch.
4. Open a pull request and wait for all CI checks.
5. Merge the feature pull request into `main`.
6. Wait for automation to open the Version Packages pull request.
7. From the new `main`, manually publish both provider packages at
   `0.1.0-beta.0` and backfill their GitHub prereleases.
8. Configure trusted publishing for all three npm packages.
9. Review the Version Packages pull request. It should prepare
   `0.1.0-beta.1` for core, Blooio, and Photon.
10. Merge the Version Packages pull request.
11. Confirm the workflow publishes all packages and creates package-specific
    GitHub Releases.
12. Verify npm tags, provenance, package versions, and installation from a
    separate project.

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

npm authenticates the GitHub Actions job through trusted publishing with OIDC.
No repository `NPM_TOKEN` is used. Each changed package is published under the
dist-tag appropriate to the release mode:

- prerelease mode `beta` publishes versions such as `0.1.0-beta.1` under
  `beta`;
- stable releases publish under `latest`.

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
pnpm changeset status
```

## Leaving beta

When the public API is ready for a stable release:

```bash
pnpm changeset pre exit
```

Commit the changed `.changeset/pre.json` in a normal pull request. Review the
resulting stable versions in the Version Packages pull request before merging
it. Stable publication moves packages to npm’s `latest` tag.

## Package archive checks

`pnpm pack` creates a `.tgz` tarball: the compressed archive that npm uploads
and consumers install. It contains the built JavaScript, declarations,
metadata, README, and license—not the entire repository.

CI checks each real tarball with:

- **Publint**, which validates package metadata, exports, file inclusion, and
  JavaScript/type entry-point consistency.
- **Are the Types Wrong?**, which validates TypeScript resolution under ESM
  and bundler module-resolution modes.
- A clean TypeScript consumer that installs the tarballs, imports every public
  package, and checks provider-specific generic inference.
