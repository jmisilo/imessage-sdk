# Changesets

Every pull request that changes a public package should include a changeset:

```bash
pnpm changeset
```

Select only the affected public packages and use conventional Semantic
Versioning: patch for compatible fixes, minor for compatible features, and
major for breaking changes. Changes to tests, documentation, examples, or
private packages alone do not require a changeset.

The release workflow collects these files into a Version Packages pull request.
Merging that pull request publishes the changed packages and creates their Git
tags and GitHub Releases.
