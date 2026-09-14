# Private-First npm Packaging Implementation Plan

> **Completed and superseded:** implemented in #13. The package has since moved to
> public npmjs.com publishing — see `RELEASING.md`. Kept for history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MCP server installable as a versioned, private GitHub Packages npm package (`@xveyn/codebase-semantic-search`), with an automated release workflow and a documented path to a later public npmjs release.

**Architecture:** No source-code changes. We add publish metadata to `package.json` (scoped name, `bin`, `files` whitelist, `exports`, `prepublishOnly`, `publishConfig`→GitHub Packages), a `release.yml` workflow that publishes on GitHub Release using the built-in `GITHUB_TOKEN`, and `RELEASING.md` documenting the release + consumer-install + public-transition flows. Verification is via `npm pack --dry-run` (no actual publish this session).

**Tech Stack:** npm, GitHub Packages, GitHub Actions, TypeScript (`tsc` build to `build/`).

**Branch:** `chore/npm-package` (already created; the design spec is already committed there).

---

## File Structure

- Modify: `package.json` — add publish metadata (name/bin/files/types/exports/prepublishOnly/publishConfig).
- Create: `.github/workflows/release.yml` — publish-on-release workflow for GitHub Packages.
- Create: `RELEASING.md` — release process, private-consumer install, public-transition guide.
- Modify: `README.md` — add "Install from GitHub Packages" subsection.
- Modify: `CHANGELOG.md` — note packaging under Unreleased.

Note: packaging/config changes are verified with `npm run build` + `npm pack --dry-run` + `npm test` rather than unit tests, since they produce no runtime code.

---

### Task 1: Add publish metadata to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Change the package name to the scoped private name**

Replace:
```json
  "name": "codebase-semantic-search",
```
with:
```json
  "name": "@xveyn/codebase-semantic-search",
```

- [ ] **Step 2: Add `bin`, `types`, and `exports` after the `main` field**

Find:
```json
  "type": "module",
  "main": "build/index.js",
```
Replace with:
```json
  "type": "module",
  "main": "build/index.js",
  "types": "build/index.d.ts",
  "bin": {
    "codebase-semantic-search": "build/index.js"
  },
  "exports": {
    ".": {
      "types": "./build/index.d.ts",
      "default": "./build/index.js"
    }
  },
  "files": [
    "build",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
```

- [ ] **Step 3: Add `prepublishOnly` to scripts**

Find:
```json
  "scripts": {
    "build": "tsc",
    "start": "node build/index.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```
Replace with:
```json
  "scripts": {
    "build": "tsc",
    "start": "node build/index.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build && npm test"
  },
```

- [ ] **Step 4: Add `publishConfig` pointing at GitHub Packages**

Find:
```json
  "engines": {
    "node": ">=18"
  },
```
Replace with:
```json
  "engines": {
    "node": ">=18"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
```

- [ ] **Step 5: Verify package.json is valid JSON and fields are present**

Run:
```bash
node -e "const p=require('./package.json');console.log('name:',p.name,'| bin:',JSON.stringify(p.bin),'| files:',JSON.stringify(p.files),'| registry:',p.publishConfig.registry)"
```
Expected output:
```
name: @xveyn/codebase-semantic-search | bin: {"codebase-semantic-search":"build/index.js"} | files: ["build","README.md","LICENSE","CHANGELOG.md"] | registry: https://npm.pkg.github.com
```

- [ ] **Step 6: Build, then verify the packed tarball contents**

Run:
```bash
npm run build && npm pack --dry-run
```
Expected: build succeeds (no `tsc` errors), and the `npm pack --dry-run` "Tarball Contents" lists `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, and `build/` files (including `build/index.js` and `build/index.d.ts`). It must **NOT** list `src/`, `test/`, `*.log`, `tsconfig.json`, or `.github/`.

- [ ] **Step 7: Confirm the bin target exists**

Run:
```bash
node -e "require('fs').accessSync('build/index.js');console.log('bin target OK')"
```
Expected: `bin target OK`

- [ ] **Step 8: Commit**

```bash
git add package.json
git commit -m "Add npm publish metadata (scoped name, bin, files, GitHub Packages)"
```

---

### Task 2: Add the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the release workflow file**

Create `.github/workflows/release.yml` with exactly:
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
    name: Publish to GitHub Packages
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 22.x
          registry-url: https://npm.pkg.github.com
          scope: '@xveyn'
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Test
        run: npm test

      - name: Publish
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Validate the YAML parses**

Run:
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/release.yml','utf8');if(!s.includes('npm.pkg.github.com')||!s.includes('packages: write')){throw new Error('missing key fields')}console.log('release.yml looks valid')"
```
Expected: `release.yml looks valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Add release workflow publishing to GitHub Packages on release"
```

---

### Task 3: Add RELEASING.md

**Files:**
- Create: `RELEASING.md`

- [ ] **Step 1: Create RELEASING.md**

Create `RELEASING.md` with exactly:
```markdown
# Releasing

This package is published privately to **GitHub Packages** as
`@xveyn/codebase-semantic-search`. Publishing is automated by
`.github/workflows/release.yml`.

## Cutting a release (maintainer)

1. Bump `version` in `package.json`.
2. Move the relevant `CHANGELOG.md` entries from `Unreleased` into a new
   versioned section.
3. Open a PR with those changes and merge it (master is protected; use
   `gh pr merge <n> --squash --admin` when working solo).
4. Create a GitHub Release with tag `vX.Y.Z` (matching the new version).
   Publishing the release triggers the `Release` workflow, which builds, tests,
   and runs `npm publish` to GitHub Packages using the built-in `GITHUB_TOKEN`.

You can also trigger the workflow manually from the Actions tab
(`workflow_dispatch`); it publishes whatever version is in `package.json` on the
default branch.

## Installing the private package (consumer)

GitHub Packages requires authentication even for reading. In the consuming
project (or your home directory for global installs), add an `.npmrc`:

```
@xveyn:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Set `GITHUB_TOKEN` to a GitHub Personal Access Token with the `read:packages`
scope. Then install:

```bash
npm install -g @xveyn/codebase-semantic-search
```

Register it with Claude Code (the bin is named `codebase-semantic-search`):

```bash
claude mcp add codebase-search -- codebase-semantic-search
```

## Transitioning to a public npmjs release (later)

When ready to publish publicly:

1. Make the GitHub repository public.
2. Rename the package to the unscoped `codebase-semantic-search` in
   `package.json`.
3. Change `publishConfig` to npmjs and public access:
   ```json
   "publishConfig": { "access": "public" }
   ```
   (Remove the GitHub Packages `registry` line so it defaults to npmjs.)
4. Configure npm **Trusted Publishing** (OIDC) for this repo + the release
   workflow on npmjs.com, so no long-lived `NPM_TOKEN` is needed.
5. In `release.yml`: switch `registry-url` to `https://registry.npmjs.org`, drop
   the `scope`, add `id-token: write` to `permissions`, and publish with
   provenance:
   ```yaml
   - run: npm publish --provenance --access public
   ```
```

- [ ] **Step 2: Verify it is non-empty and mentions the key flows**

Run:
```bash
node -e "const s=require('fs').readFileSync('RELEASING.md','utf8');['Cutting a release','Installing the private package','Transitioning to a public'].forEach(h=>{if(!s.includes(h))throw new Error('missing: '+h)});console.log('RELEASING.md complete')"
```
Expected: `RELEASING.md complete`

- [ ] **Step 3: Commit**

```bash
git add RELEASING.md
git commit -m "Add RELEASING.md (release flow, private install, public transition)"
```

---

### Task 4: Update README and CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a GitHub Packages install subsection to the README**

In `README.md`, find the "### 3. Register with Claude Code" section:
```markdown
### 3. Register with Claude Code

```bash
claude mcp add codebase-search -- node "/path/to/codebase-semantic-search/build/index.js"
```
```
Replace it with:
```markdown
### 3. Register with Claude Code

After a local build:

```bash
claude mcp add codebase-search -- node "/path/to/codebase-semantic-search/build/index.js"
```

**Or install from GitHub Packages (private package):**

Add an `.npmrc` (see [RELEASING.md](RELEASING.md) for details):

```
@xveyn:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then:

```bash
npm install -g @xveyn/codebase-semantic-search
claude mcp add codebase-search -- codebase-semantic-search
```
```

- [ ] **Step 2: Add a packaging note to CHANGELOG Unreleased → Added**

In `CHANGELOG.md`, find:
```markdown
### Added
- Community health files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  issue/PR templates.
- GitHub Actions CI (build + test on Node 18/20/22).
- Dependabot configuration for npm and GitHub Actions.
```
Replace with:
```markdown
### Added
- Community health files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  issue/PR templates.
- GitHub Actions CI (build + test on Node 18/20/22).
- Dependabot configuration for npm and GitHub Actions.
- npm packaging: scoped package `@xveyn/codebase-semantic-search` with a
  `codebase-semantic-search` bin, a `files` whitelist, and a release workflow
  publishing to GitHub Packages. See `RELEASING.md`.
```

- [ ] **Step 3: Verify both edits landed**

Run:
```bash
node -e "const fs=require('fs');if(!fs.readFileSync('README.md','utf8').includes('npm.pkg.github.com'))throw new Error('README missing install section');if(!fs.readFileSync('CHANGELOG.md','utf8').includes('@xveyn/codebase-semantic-search'))throw new Error('CHANGELOG missing packaging note');console.log('docs updated')"
```
Expected: `docs updated`

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "Document GitHub Packages install in README and CHANGELOG"
```

---

### Task 5: Final verification and PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Clean build + full test + audit**

Run:
```bash
npm run build && npm test && npm audit
```
Expected: build clean; `Tests 17 passed (17)`; `found 0 vulnerabilities`.

- [ ] **Step 2: Final pack dry-run review**

Run:
```bash
npm pack --dry-run 2>&1
```
Expected: tarball contains `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, and `build/**` only. Confirm no `src/`, `test/`, `docs/`, `*.log`, or `tsconfig.json` appear.

- [ ] **Step 3: Push the branch and open a PR**

Run:
```bash
git push -u origin chore/npm-package
gh pr create --base master --title "Package as private GitHub Packages npm package" --body "Implements docs/superpowers/specs/2026-06-07-npm-package-publishing-design.md. Adds publish metadata, a release workflow (GitHub Packages, GITHUB_TOKEN auth), and RELEASING.md. No source changes; verified with npm pack --dry-run. No publish performed."
```
Expected: a PR URL is printed.

- [ ] **Step 4: Wait for CI, then merge with admin override**

Run:
```bash
PR=$(gh pr view --json number --jq .number)
until [ "$(gh pr checks $PR --json state --jq 'all(.[]; .state=="SUCCESS" or .state=="FAILURE" or .state=="ERROR")' 2>/dev/null)" = "true" ]; do sleep 5; done
gh pr checks $PR
```
Expected: both `Build & Test (Node 20.x)` and `Build & Test (Node 22.x)` pass. Then:
```bash
gh pr merge $PR --squash --admin --delete-branch
```
Expected: PR merged, branch deleted.

---

## Notes for the implementer

- **Do not run `npm publish`** anywhere — this work only prepares and verifies.
- **Do not change dependencies.** If any dependency ever needs changing, regenerate the lockfile cleanly (`rm -rf node_modules package-lock.json && npm install`) or `npm ci` fails on the Linux runners (known project gotcha).
- master is protected (PR + 1 review). Solo merges use `gh pr merge --admin`.
- `npm pack --dry-run` does not run `prepublishOnly`; that is why Step 1 of Task 1 / Task 5 builds first so `build/` exists for packing.
