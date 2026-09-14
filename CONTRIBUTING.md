# Contributing to vectorgrep

Thanks for your interest in contributing! This document explains how to get a
development environment running and what we expect from contributions.

## Getting Started

```bash
git clone https://github.com/Xveyn/vectorgrep.git
cd vectorgrep
npm install
npm run build
```

Requires **Node.js 20 or newer** (CI tests Node 20 and 22).

### Optional: Ollama for fast embeddings

```bash
# Install from https://ollama.com
ollama pull nomic-embed-text
```

If Ollama is not running, the server automatically falls back to transformers.js,
so it is not required for development.

## Development Workflow

```bash
npm run build      # Compile TypeScript -> build/
npm run dev        # Watch mode
npm test           # Run the full test suite (vitest)
npm run test:watch # Watch mode for tests
```

The test suite uses a mock embedding provider and runs fully offline — no Ollama
or network access required.

## Pull Requests

1. **Fork & branch** — create a feature branch off `master`
   (`git checkout -b feat/my-change`).
2. **Keep changes focused** — one logical change per PR.
3. **Add tests** — new behaviour should come with tests under `test/`.
4. **Verify locally** before pushing:
   ```bash
   npm run build && npm test
   ```
5. **Open the PR** against `master` and fill out the PR template. CI (build +
   tests) must pass and the branch must be up to date before merge.

## Coding Conventions

The project follows a few conventions that are easy to miss — see `CLAUDE.md`
for the full list. The most important ones:

- **ESM modules** — use `.js` extensions in relative imports.
- **LanceDB camelCase columns** must be escaped with backticks in filters:
  `` `filePath` ``, `` `symbolName` ``. Double quotes (`"filePath"`) are parsed
  as a string literal, so the filter silently never matches.
- **Vectors read from LanceDB** are Arrow `Vector`s, not arrays — convert with
  `Array.from()` before reusing them.
- **Filter placeholder records** (`__placeholder__`) when reading empty tables.
- **Logging goes to stderr only** — `stdout` is reserved for the MCP protocol.
- Run any user-controlled value through the helpers in `src/utils/sanitize.ts`
  before putting it into a LanceDB filter (SQL-injection protection).

## Reporting Bugs & Requesting Features

Please use the GitHub issue templates. For security-sensitive reports, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
