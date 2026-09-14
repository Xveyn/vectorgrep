# Security Policy

## Supported Versions

This project is pre-1.0. Security fixes are applied to the latest `master` and
released in the next version. There is no long-term support for older releases.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately via GitHub's
[private vulnerability reporting](https://github.com/Xveyn/codebase-semantic-search/security/advisories/new).

Please include a description, reproduction steps, and the affected version/commit.
We aim to acknowledge reports within a few days.

## Threat Model & Scope

This is a **local, offline** MCP server. It:

- communicates with Claude Code over **stdio** (not an HTTP server),
- stores all data locally under `~/.vectordb/` (or `$VECTORDB_PATH`),
- only reads files you explicitly point it at for indexing.

User-controlled inputs that reach LanceDB filters (file patterns, languages,
symbol types, file paths) are sanitized via `src/utils/sanitize.ts` to prevent
filter/SQL injection.

### A note on dependency advisories

Several transitive dependencies surface advisories that are **not reachable in
this project's code path**, for example:

- **`hono` / `@hono/node-server`** — pulled in by `@modelcontextprotocol/sdk`
  for its *HTTP* transport. This server uses the **stdio** transport, so the
  HTTP/JSX/cookie/JWT issues are never exercised.
- **`protobufjs` / `onnxruntime`** — used by transformers.js only while loading
  trusted, locally-stored model files.
- **`vitest` / `vite`** — development/test dependencies only, not shipped at
  runtime.

We still keep dependencies up to date via Dependabot and `npm audit`, but the
practical exposure of these advisories in normal usage is minimal.
