# vectorgrep

[![CI](https://github.com/Xveyn/vectorgrep/actions/workflows/ci.yml/badge.svg)](https://github.com/Xveyn/vectorgrep/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/vectorgrep.svg)](https://www.npmjs.com/package/vectorgrep)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

MCP Server for **vector-based semantic code search** in [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Index your entire codebase locally and search code, files, and symbols using natural language — no exact keywords needed.

Built with [LanceDB](https://lancedb.com/) (embedded vector database) and [Ollama](https://ollama.com/) / transformers.js for embeddings. Fully local, fully offline.

## Features

- **Semantic Code Search** — find code by describing what it does, not by exact names
- **File Discovery** — "which files handle authentication?" → ranked results
- **Symbol Search** — find functions, classes, types by name or description
- **Incremental Updates** — only re-index changed files
- **Auto-Detection** — automatically uses Ollama if available, falls back to transformers.js
- **Fast** — 1063 files indexed in 16s, searches under 50ms (with Ollama)
- **Fully Local** — all data stored in `~/.vectordb/`, nothing leaves your machine

## Quick Start

Requires **Node.js 20 or newer**. No need to clone the repository — vectorgrep
is published on [npm](https://www.npmjs.com/package/vectorgrep).

### 1. Set up an embedding provider

**Option A — Ollama (recommended, fast):**
```bash
# Install from https://ollama.com
ollama pull nomic-embed-text
```

**Option B — transformers.js (zero setup, slower):**
Nothing to do. It ships with vectorgrep and is used automatically if Ollama is not running.

### 2. Register with Claude Code

```bash
npm install -g vectorgrep
claude mcp add vectorgrep -- vectorgrep
```

Or without a global install — npx checks npm for the newest release whenever
Claude Code starts the server:

```bash
claude mcp add vectorgrep -- npx -y vectorgrep@latest
```

### 3. Use

In a Claude Code session:

```
> "Initialize the search index for /path/to/my/project"
> "Find the code that handles user authentication"
> "Which files are related to the payment module?"
> "Search for functions that validate input"
> "Update the index"
```

### Updating

New versions and their changes are listed under
[Releases](https://github.com/Xveyn/vectorgrep/releases).

```bash
npm install -g vectorgrep@latest
```

Then restart Claude Code. With the `npx … vectorgrep@latest` registration, a
restart is enough. If the release notes say so, run `reindex` for your projects
afterwards.

Want to work on vectorgrep itself? See [CONTRIBUTING.md](CONTRIBUTING.md) for
building from source.

## MCP Tools

| Tool | Description |
|------|-------------|
| `init` | Index a project (scans files → chunks → embeddings → vector DB) |
| `search_code` | Semantic code search with natural language |
| `search_files` | Find relevant files by description |
| `search_symbols` | Search functions, classes, types, interfaces |
| `index_status` | Show index statistics |
| `index_update` | Incremental update (only changed files) |
| `reindex` | Full rebuild of the index |

## Architecture

```
src/
├── index.ts              # MCP Server entry point (stdio transport)
├── server.ts             # Tool registration
├── config/               # .vectordb.json schema + loader
├── db/                   # LanceDB connection, schemas, operations
├── embedding/            # Ollama, transformers.js, OpenAI providers
├── chunking/             # AST-based (tree-sitter) + line-based chunking
├── indexing/             # File scanning, change detection, pipeline
├── search/              # Search engine + result formatting
├── tools/               # 7 MCP tool handlers
└── utils/               # Logger, paths, git, hashing, concurrency
```

### How it works

1. **Scan** — discovers files via `git ls-files` or glob patterns
2. **Chunk** — splits files into semantic chunks (AST-based when tree-sitter grammars are available, line-based fallback)
3. **Embed** — generates vector embeddings for each chunk using Ollama or transformers.js
4. **Store** — saves vectors + metadata in LanceDB at `~/.vectordb/projects/<hash>/`
5. **Search** — embeds your query, finds nearest vectors, returns formatted results

### Data Storage

```
~/.vectordb/projects/<sha256-hash>/
├── lancedb/          # Vector database files
└── metadata.json     # Provider, dimensions, timestamps
```

Stored outside your project — no `.gitignore` needed, no repo bloat.

## Configuration

Optional `.vectordb.json` in your project root:

```json
{
  "embedding": {
    "provider": "auto",
    "batchSize": 100
  },
  "files": {
    "include": ["**/*"],
    "exclude": ["**/node_modules/**", "**/dist/**"],
    "maxFileSize": 1000000,
    "gitOnly": true
  },
  "chunking": {
    "maxChunkLines": 100,
    "overlapLines": 10
  }
}
```

`embedding.model` is optional and provider-specific. Without it, each provider
uses its own default: `nomic-embed-text` (Ollama), `Xenova/all-MiniLM-L6-v2`
(transformers.js), `text-embedding-3-small` (OpenAI).

## Performance

| Codebase | Files | Chunks | Index Time (Ollama) | Search |
|----------|-------|--------|---------------------|--------|
| Small (50 files) | 49 | 107 | 1s | <10ms |
| Medium (1k files) | 1,063 | 3,063 | 16s | <20ms |
| Large (10k files) | ~10k | ~30k | ~5min | <50ms |

## Supported Languages

TypeScript, JavaScript, Python, Rust, Go, Java, C, C++, C#, Ruby, PHP, Swift, Kotlin, Scala, HTML, CSS, JSON, Markdown, Shell, Lua, and more (30+ extensions).

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set
up a development environment and open a pull request. Please also review our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

For security policy and how to report vulnerabilities, see
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Xveyn
