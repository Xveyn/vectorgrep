# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Community health files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  issue/PR templates.
- GitHub Actions CI (build + test on Node 20/22).
- Dependabot configuration for npm and GitHub Actions.
- npm packaging: package `vectorgrep` with a
  `vectorgrep` bin and a `files` whitelist, published publicly to
  npmjs.com by a release workflow using trusted publishing with provenance.
  See `RELEASING.md`.

### Changed
- **Renamed the project to `vectorgrep`** (npm package, CLI command, MCP server
  name and GitHub repository, formerly `codebase-semantic-search`). The storage
  location `~/.vectordb/` and the `.vectordb.json` config file are unchanged.
- **Node.js 20 or newer is required** (Node 18 is end-of-life).
- Removed the unused dependencies `@anthropic-ai/sdk` and `chokidar`.
- Bumped dependencies to resolve security advisories; `sharp` and `adm-zip` are
  pinned to patched versions via `overrides`.
- Upgraded `vitest` to v4, `zod` to v4 (object-level config defaults use
  `.prefault({})`), `@huggingface/transformers` to v4 and `glob` to v13.
- Bumped `actions/checkout` and `actions/setup-node` to v7.
- `embedding.model` is optional; each embedding provider uses its own default
  model when none is configured.
- Include/exclude patterns are matched with `minimatch` in both discovery modes.
  Files in dot-directories such as `.github/` are no longer indexed in git mode
  unless an include pattern names them.

### Fixed
- LanceDB filters on camelCase columns never matched, because double-quoted
  identifiers are string literals: `index_update` duplicated modified files and
  kept deleted ones, `filePattern` and `symbolTypes` filters returned nothing, and
  exact symbol-name matching never ran (#24).
- Reused chunk vectors were stored as `NaN` during incremental updates (#24).
- The default config was a shared object mutated across projects and calls, so
  settings from one `init` leaked into other projects (#25).
- The transformers.js fallback persisted the wrong embedding model, breaking
  every search and `index_update` after `init` (#18, #25).
- `LineChunker` looped forever when `overlapLines >= maxChunkLines` (#26).
- AST chunking dropped the bodies of long functions and all code outside
  declarations, and produced duplicate chunk ids for symbols sharing a line
  range (#26).
- Tree-sitter WASM lookup used `require.resolve`, which doesn't exist in ESM (#26).
- In git mode, default exclude patterns never matched, `include` was ignored,
  non-ASCII filenames were skipped, and a failing `git ls-files` produced an empty
  index instead of falling back to glob (#27).

### Upgrade notes
- Run `reindex` once after upgrading. Existing indexes may contain duplicate or
  stale chunks, miss code that was previously dropped, or record the wrong
  embedding model.

## 0.1.0 - 2026-03

### Added
- Initial release: MCP server for semantic code search.
- Semantic code, file, and symbol search via natural language.
- Hybrid search (BM25 + vector fusion).
- Incremental updates with chunk-level hashing.
- Ollama / transformers.js / OpenAI embedding providers.
- Tree-sitter AST chunking with line-based fallback.
- SQL-injection protection and retry logic for embedding APIs.

[Unreleased]: https://github.com/Xveyn/vectorgrep/commits/master
