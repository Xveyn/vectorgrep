# Releasing

`vectorgrep` is published publicly to **npmjs.com** as
[`vectorgrep`](https://www.npmjs.com/package/vectorgrep) (formerly
`codebase-semantic-search`).

Releases are created by `.github/workflows/release.yml` as soon as a PR labeled
**`release:major`**, **`release:minor`** or **`release:patch`** is merged into
`master`. The label only triggers the release — the version number comes from
`package.json`. The workflow never pushes to `master`: the version bump and the
changelog entry belong in the release PR.

npm packages are published with **trusted publishing** (OIDC): no npm token is
stored in the repository, and npm attaches a provenance attestation.

## Cutting a release

1. Branch off `master` as `release/X.Y.Z`.
2. Bump the version (updates `package.json` and `package-lock.json`):
   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```
3. Add the `CHANGELOG.md` section — **required**, it *is* the body of the GitHub
   release:
   ```markdown
   ## X.Y.Z — YYYY-MM-DD

   Optional one- or two-sentence summary.

   ### Added
   ### Changed
   ### Fixed
   ### Internal
   ```
   Describe what changed for users, not the work done. Leave out bugs that were
   introduced and fixed between two releases — they never shipped. Omit empty
   categories.
4. Commit as `chore(release): X.Y.Z`, open a PR and set the matching
   `release:*` label. **Set the label before merging** — the workflow reads the
   labels of the merged PR, so a label added afterwards doesn't trigger a release.
5. Merge the PR (master is protected; solo: `gh pr merge <n> --squash --admin`).

The workflow then runs two jobs:

- **`pre-check`** — skips the run if the merged PR has no `release:*` label,
  reads the version from `package.json`, fails if tag `vX.Y.Z` already exists,
  and fails if `CHANGELOG.md` has no (or an empty) `## X.Y.Z` section
  (`node scripts/release-notes.mjs --check`).
- **`publish`** — installs, builds and tests; runs `npm publish` unless that
  version is already on npm; writes the release notes from the changelog;
  pushes tag `vX.Y.Z` and creates the GitHub release **vectorgrep vX.Y.Z** with
  those notes. If creating the release fails, it deletes the partial release
  and the tag again.

A manual run (Actions → **Release** → *Run workflow*) skips the label gate and
releases whatever version is in `package.json` on the chosen branch.

## One-time setup: the first release

npm can only configure trusted publishing for a package that already exists, so
the first version is published by hand **before** its release PR is merged:

1. On the release PR branch, logged in with the npm account that should own the
   package:
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
4. Set the `release:*` label and merge the release PR. The workflow sees the
   version is already on npm, skips publishing and only creates the tag and the
   GitHub release.
5. Optional: delete the old private `@xveyn/codebase-semantic-search` package on
   GitHub Packages (repository → Packages → package settings).

## Recovery

- **Release PR merged without a `release:*` label**: the `pre-check` job skipped
  the release. Start the workflow manually on `master` (Actions → **Release** →
  *Run workflow*, or `gh workflow run release.yml --ref master`); it releases the
  version in `package.json`.
- **Release creation failed** (network, rate limit): the job already removed the
  tag and the partial release. Re-run the workflow — publishing is skipped if
  the version reached npm.
- **Job died between pushing the tag and the rollback** (cancelled, runner lost):
  the pre-check of a re-run stops at "tag already exists". Delete the tag, then
  re-run:
  ```bash
  git push origin :refs/tags/vX.Y.Z
  ```
- **Version published to npm with a problem**: npm versions can't be reused.
  Fix it in a new patch release (`X.Y.Z+1`); deprecate the bad version with
  `npm deprecate vectorgrep@X.Y.Z "<reason>"` if needed.

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
claude mcp add vectorgrep -- npx -y vectorgrep@latest
```
