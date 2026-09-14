# Design: Publish as a (private-first) npm package

> **Superseded (2026-09):** the repository is public and the package is published
> publicly to npmjs.com as `vectorgrep` (project renamed from
> `codebase-semantic-search`). See `RELEASING.md` for the current process. Kept for history.

**Date:** 2026-06-07
**Status:** Approved (pending spec review)
**Repo:** Xveyn/codebase-semantic-search (currently private)

## Goal

Make the MCP server installable as a versioned npm package so it can be
consumed via `npx` / `claude mcp add` instead of a manual `git clone` + build.
Start as a **private** package on **GitHub Packages** (scope `@xveyn`), with a
documented path to a later **public** release on npmjs.com.

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| Package name (private phase) | `@xveyn/codebase-semantic-search` (scoped — required for private) |
| CLI command name | `codebase-semantic-search` (bin name, may differ from package name) |
| Registry (private phase) | GitHub Packages — `https://npm.pkg.github.com` |
| Publish auth | Built-in `GITHUB_TOKEN` in Actions (no extra secret/setup) |
| Publish trigger | GitHub Release `published` + manual `workflow_dispatch` |
| Files included | Whitelist via `files` field (overrides the `.gitignore` fallback) |
| Provenance | Not in private phase (npmjs feature); enabled at public transition |
| Scope of this work | Prepare + verify only — no actual publish this session |

## Why these choices

- **Scoped + GitHub Packages:** npm only allows private packages under a scope,
  and private packages on npmjs.com require a paid plan. GitHub Packages is free
  for private packages, tied to the private repo, and authenticates in Actions
  with the built-in `GITHUB_TOKEN` — zero extra setup.
- **`files` whitelist:** `build/` is in `.gitignore`. With no `files` field and
  no `.npmignore`, npm falls back to `.gitignore` and would **exclude the
  compiled output**, producing a broken package. An explicit `files` whitelist
  fixes this and also keeps `src/`, tests, and logs out of the tarball.
- **`bin` name ≠ package name:** keeps the ergonomic `codebase-semantic-search`
  command even though the package is scoped.

## Changes

### 1. `package.json`

Add/modify the following fields (existing metadata — keywords, repository, bugs,
homepage, engines, license, description — stays):

```jsonc
{
  "name": "@xveyn/codebase-semantic-search",
  "version": "0.1.0",
  "bin": { "codebase-semantic-search": "build/index.js" },
  "types": "build/index.d.ts",
  "exports": {
    ".": {
      "types": "./build/index.d.ts",
      "default": "./build/index.js"
    }
  },
  "files": ["build", "README.md", "LICENSE", "CHANGELOG.md"],
  "scripts": {
    "prepublishOnly": "npm run build && npm test"
    // existing scripts unchanged
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  }
}
```

Notes:
- `main` stays `build/index.js`.
- `prepublishOnly` runs on every `npm publish` (local and CI), guaranteeing the
  shipped `build/` is freshly compiled and tests pass.
- `src/index.ts` already starts with `#!/usr/bin/env node`, so the bin is
  directly executable; npm sets the executable bit on install.
- GitHub Packages requires the `repository` field's owner to match the scope.
  Ours is `github.com/Xveyn/...` and the scope is `@xveyn` (matches,
  case-insensitive) — no change needed, but it must stay in sync.

### 2. `.github/workflows/release.yml` (new)

```yaml
name: Release

on:
  release:
    types: [published]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22.x
          registry-url: https://npm.pkg.github.com
          scope: '@xveyn'
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Notes:
- `packages: write` grants the publish permission to GitHub Packages.
- `setup-node` writes the project `.npmrc` so `npm publish` targets GitHub
  Packages with the scope.
- No provenance flag in the private phase.
- This is separate from the existing `ci.yml` (which keeps running build+test on
  push/PR across Node 20/22).

### 3. `RELEASING.md` (new)

Documents the operational flow:

- **Cutting a release (maintainer):** bump `version` in `package.json`, update
  `CHANGELOG.md`, commit via PR, then create a GitHub Release with tag
  `vX.Y.Z`. The Release event triggers `release.yml`.
- **Installing the private package (consumer):** create an `.npmrc` with
  ```
  @xveyn:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
  ```
  using a GitHub PAT with `read:packages`, then
  `npm i -g @xveyn/codebase-semantic-search` (or `npx`), and register with
  `claude mcp add codebase-search -- codebase-semantic-search`.
- **Transition to public npmjs (later):** rename to unscoped
  `codebase-semantic-search`, change `publishConfig.registry` to npmjs (or
  remove) with `access: public`, configure npm Trusted Publishing (OIDC) for the
  repo+workflow, add `id-token: write` permission and `npm publish --provenance`.
  Make the repo public so provenance is publicly verifiable.

### 4. Documentation touch-ups

- README "Register with Claude Code" section: add an "Install from GitHub
  Packages" subsection (private-phase instructions) alongside the existing
  clone-and-build instructions. Keep clone-and-build as the contributor path.
- `CHANGELOG.md` Unreleased: note packaging (bin, files, release workflow).

## Verification (this session, no publish)

1. `npm run build` — clean.
2. `npm test` — 17/17 pass.
3. `npm pack --dry-run` — confirm the tarball contains exactly:
   `build/**` (incl. `index.js`, `.d.ts`), `package.json`, `README.md`,
   `LICENSE`, `CHANGELOG.md` — and **excludes** `src/`, `test/`, `*.log`,
   `.github/`, `tsconfig.json`.
4. Smoke-check the packed bin path resolves (`build/index.js` exists and is the
   bin target).

## Out of scope (YAGNI)

- No bundler (tsup/esbuild) — `tsc` output is sufficient.
- No automated version bumping / semantic-release — releases are triggered
  manually via GitHub Releases.
- No actual publish this session.
- No monorepo / workspaces.

## Risks & mitigations

- **Broken tarball (missing `build/`):** mitigated by the `files` whitelist and
  the `npm pack --dry-run` verification step.
- **Consumer auth friction (private):** unavoidable for private GitHub Packages;
  documented in `RELEASING.md`. Resolves entirely at the public transition.
- **Lockfile cross-platform drift:** any dependency change must regenerate the
  lockfile cleanly (`rm -rf node_modules package-lock.json && npm install`) or
  `npm ci` fails on Linux runners. (Known project gotcha — no dep changes are
  required by this work, but `prepublishOnly` runs `npm ci`-equivalent installs
  in CI.)
