# Changelog

## 0.2.0 — 2026-09-14

The first public release on npm, under the new name `vectorgrep` — plus a long
list of search and indexing fixes found in a code audit and in an end-to-end
test against a real ~2,700-file project.

### Added
- **Published on npm** as `vectorgrep`: `npm install -g vectorgrep` or
  `npx -y vectorgrep`, no clone and build needed. Releases are published with
  npm trusted publishing and carry a provenance attestation.

### Changed
- **Renamed the project to `vectorgrep`** (npm package, CLI command, MCP server
  name and GitHub repository, formerly `codebase-semantic-search`). The storage
  location `~/.vectordb/` and the `.vectordb.json` config file are unchanged.
- **Node.js 20 or newer is required** (Node 18 is end-of-life).
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
- `init` and `reindex` silently discarded the entire index while reporting success
  when another MCP server process recreated the tables during indexing; searches
  then returned nothing (#47).

### Internal
- Community health files (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  issue/PR templates), CI on Node 20/22 and Dependabot.
- **Release process**: a PR labeled `release:major|minor|patch` publishes to npm
  on merge, tags the version and uses this changelog section as the GitHub
  release notes. See `RELEASING.md`.
- Removed the unused dependencies `@anthropic-ai/sdk` and `chokidar`; bumped
  dependencies to resolve security advisories, with `sharp` and `adm-zip` pinned
  via `overrides`.
- Upgraded `vitest` to v4, `zod` to v4, `@huggingface/transformers` to v4 and
  `glob` to v13.
- CI and release skip onnxruntime-node's CUDA download, which repeatedly timed
  out (#48).

### Upgrade notes
- Run `reindex` once after upgrading. Existing indexes may contain duplicate or
  stale chunks, miss code that was previously dropped, or record the wrong
  embedding model.

## 0.1.0 — 2026-03

### Added
- Initial release: MCP server for semantic code search.
- Semantic code, file, and symbol search via natural language.
- Hybrid search (BM25 + vector fusion).
- Incremental updates with chunk-level hashing.
- Ollama / transformers.js / OpenAI embedding providers.
- Tree-sitter AST chunking with line-based fallback.
- SQL-injection protection and retry logic for embedding APIs.
