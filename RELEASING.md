# Releasing

This package is published publicly to **npmjs.com** as
[`vectorgrep`](https://www.npmjs.com/package/vectorgrep). The project was
formerly called `codebase-semantic-search`.

Releases are published by `.github/workflows/release.yml` using npm
**trusted publishing** (OIDC): no npm token is stored in the repository, and npm
attaches a provenance attestation automatically.

## One-time setup (maintainer)

npm can only configure trusted publishing for a package that already exists, so
the very first version has to be published manually.

1. Publish the first version from a clean checkout of `master`, logged in with
   the npm account that should own the package:
   ```bash
   npm login
   npm ci
   npm publish   # prepublishOnly runs build + tests; access is public via publishConfig
   ```
2. On npmjs.com open the package → **Settings** → **Trusted publishing** and add a
   GitHub Actions publisher:
   - Organization or user: `Xveyn`
   - Repository: `vectorgrep`
   - Workflow filename: `release.yml`
3. Recommended: in the same settings, require two-factor authentication and
   disallow tokens for publishing, so only the workflow can publish.
4. Optional: delete the old private `@xveyn/codebase-semantic-search` package on
   GitHub Packages (repository → Packages → package settings), which is no longer
   updated.

## Cutting a release

1. Bump `version` in `package.json`.
2. Move the relevant `CHANGELOG.md` entries from `Unreleased` into a new
   versioned section.
3. Open a PR with those changes and merge it (master is protected; use
   `gh pr merge <n> --squash --admin` when working solo).
4. Create a GitHub Release with tag `vX.Y.Z` (matching the new version).
   Publishing the release triggers the `Release` workflow, which builds, tests
   and runs `npm publish` via trusted publishing.

You can also trigger the workflow manually from the Actions tab
(`workflow_dispatch`); it publishes whatever version is in `package.json` on the
default branch. npm rejects a version that was already published.

## Troubleshooting

- **`E404` / `ENEEDAUTH` on publish** — the trusted publisher on npmjs.com doesn't
  match the workflow (owner, repository or workflow filename). npm doesn't
  validate this configuration when you save it.
- **`E422` provenance error** — `repository.url` in `package.json` must point to
  this GitHub repository (`Xveyn/vectorgrep`).
- Trusted publishing requires npm ≥ 11.5.1; the workflow updates npm before
  publishing.

## Installing (consumers)

Requires Node.js 20 or newer.

```bash
npm install -g vectorgrep
claude mcp add vectorgrep -- vectorgrep
```

Or without a global install:

```bash
claude mcp add vectorgrep -- npx -y vectorgrep
```
