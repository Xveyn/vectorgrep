# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# vectorgrep – Projekthinweise

MCP-Server für semantische Codesuche in Claude Code. Indexiert ein Projekt lokal (Tree-sitter-Chunks, Embeddings über Ollama oder transformers.js, LanceDB) und stellt Such- und Index-Tools über stdio bereit. Veröffentlicht auf npm als `vectorgrep`.

**Offene Arbeit steht in den GitHub-Issues, nicht in dieser Datei.** Taucht bei einer Aufgabe ein Nebenbefund auf (Bug, Altlast, sinnvolle Folgearbeit), der nicht zum Task gehört: nicht still mitfixen, sondern benennen (Problem, Fundort, warum out of scope) und fragen, ob ein Issue angelegt werden soll.

## Entwicklung

```bash
npm install
npm run build                                # TypeScript -> build/
npm test                                     # alle Tests (vitest)
npx vitest run test/unit/sanitize.test.ts    # eine Datei
npx vitest run -t "search_symbols"           # Tests nach Namen
npm run test:coverage                        # mit Coverage, wie in der CI auf Node 22
```

- Node.js >= 20. Die Tests laufen offline (Mock-Embedder), Ollama ist nicht nötig
- Lokal registrieren: `claude mcp add vectordb-search -- node "D:/Programme (x86)/custom_claude_code_vector_database/build/index.js"`. Der Name `vectordb-search` bleibt, weil andere Projekte (z.B. Baluhost) die Tools als `mcp__vectordb-search__*` aufrufen
- Nach `npm run build` Claude Code neu starten: ein laufender Server behält den Code, mit dem er gestartet wurde

## Architektur

- **Entry:** `src/index.ts` (stdio) -> `src/server.ts` (7 Tools, Server-Instructions)
- **Tools** (`src/tools/`): schreibend `init`, `reindex`, `index_update`; lesend `search_code`, `search_files`, `search_symbols`, `index_status`
- **Indexierung:** `file-scanner` (git ls-files bzw. glob, include/exclude über minimatch) -> `ASTChunker` (Tree-sitter, nicht abgedeckte Zeilen werden zeilenweise gechunkt; Fallback `LineChunker`) -> `pipeline` (Embeddings, Wiederverwendung unveränderter Chunk-Vektoren) -> `indexer` (Voll- und inkrementelle Indexierung)
- **Embedding:** Ollama -> transformers.js-Fallback, OpenAI optional; immer umhüllt vom `CachedEmbeddingProvider` (LRU). HTTP-Provider mit Timeout (60 s) und Retry (`HttpProviderOptions`, `src/utils/retry.ts`)
- **DB:** LanceDB embedded unter `~/.vectordb/projects/<sha256-hash>/` (`lancedb/` + `metadata.json`), Tabellen `chunks` und `files`
- **Suche:** Hybrid aus Vektor und BM25, Gewichtung nach Query-Typ (Identifier vs. Beschreibung)
- **Kontext:** `src/context.ts` cached Embedder, DB und Engine pro Projekt

## Wichtige Konventionen

- ESM-Module (`.js`-Endungen in relativen Imports). Logging nur auf stderr — stdout ist das MCP-Protokoll
- **LanceDB-Filter:** camelCase-Spalten mit Backticks escapen (`` `filePath` ``, `` `symbolName` ``). Doppelte Anführungszeichen (`"filePath"`) sind String-Literale, der Filter matcht dann still nie. Nutzereingaben immer durch `src/utils/sanitize.ts`
- Aus LanceDB gelesene Vektoren sind Arrow-`Vector`s, keine Arrays — vor Weiterverwendung `Array.from()`
- LanceDB-Abfragen liefern ohne `limit` nur **10 Zeilen** — `table.query()` genauso wie die Vektorsuche. Alle Zeilen lesen: `queryAllRows` in `src/db/operations.ts` (Limit = Anzahl der Treffer)
- Placeholder-Records (`__placeholder__`) in leeren Tabellen beim Lesen filtern
- `fullIndex` schreibt mit `overwriteChunksTable` / `overwriteFilesTable`, nie über `getOrCreate…Table(data)`: die ignorieren die Daten, wenn die Tabelle bereits existiert
- **Nebenläufigkeit:** Parallele Subagents teilen sich einen Serverprozess. Schreibende Tools laufen unter `withProjectWriteLock`, Suchen warten mit `waitForProjectWrites`, Schreibvorgänge verwerfen danach den Projekt-Kontext. Das gilt nur innerhalb eines Prozesses — mehrere Server-Prozesse sind nicht koordiniert (#46)
- **Server-Instructions und Tool-Beschreibungen sind die Nutzungsregeln für Agents** — Explore- und Plan-Subagents bekommen keine CLAUDE.md. Ändert sich das Verhalten eines Tools, Beschreibung mitziehen (`test/unit/server.test.ts`)

## Tests / CI

- CI (`.github/workflows/ci.yml`): Build und Tests auf Node 20 und 22, Node 22 mit Coverage. `ONNXRUNTIME_NODE_INSTALL=skip`, sonst lädt `npm ci` CUDA-Binaries von nuget.org und bricht regelmäßig mit Timeout ab
- Tool-Handler-Tests mocken `src/embedding/factory.js` mit `test/helpers/mock-embedding.ts`. DB-Tests laufen gegen echtes LanceDB, Scanner-Tests gegen ein echtes `git init`
- Integrationstests schreiben derzeit ins echte `~/.vectordb/` und räumen danach auf (#59)
- Bugfix: zuerst ein Test, der den Bug rot zeigt, dann der Fix

### Coverage-Floor

- Die CI bricht ab, wenn die Coverage unter die `thresholds` in `vitest.config.ts` fällt (Statements, Branches, Functions, Lines)
- **Nach neuen Tests den Floor anheben:** `npm run test:coverage` laufen lassen und die vier Werte auf die gemessenen Prozent **abgerundet** setzen (z.B. 82,92 % -> 82), im selben PR wie die Tests
- Den Floor **nie senken**, um einen PR grün zu bekommen — fehlende Tests nachziehen

### Abhängigkeiten

- Nach Änderungen an Abhängigkeiten unter Windows die Lockfile prüfen: ein inkrementelles `npm install` kann plattformspezifische optionale Pakete entfernen, dann scheitert `npm ci` in der Linux-CI. Kontrolle: `grep -c '"node_modules/@emnapi' package-lock.json` muss > 0 sein, sonst `node_modules` und `package-lock.json` löschen und neu installieren
- `apache-arrow` ist Peer-Dependency von `@lancedb/lancedb` (`<= 18.1.0`) — nur zusammen mit LanceDB anheben

## Release-Prozess

Details in `RELEASING.md`. Kurzfassung:

- Releases erzeugt `.github/workflows/release.yml`, sobald ein PR mit Label `release:major`, `release:minor` oder `release:patch` nach `master` gemerged wird. Das Label steuert nur den Trigger, die Version kommt aus `package.json`. **Das Label muss vor dem Merge gesetzt sein**, sonst wird das Release übersprungen (nachholen: Workflow manuell starten)
- Im Release-PR (Branch `release/X.Y.Z`, Commit `chore(release): X.Y.Z`): `npm version X.Y.Z --no-git-tag-version` und CHANGELOG-Abschnitt `## X.Y.Z — YYYY-MM-DD` (Added/Changed/Fixed/Internal). Der Abschnitt ist Pflicht: er *ist* der Body des GitHub-Releases, `scripts/release-notes.mjs --check` bricht sonst ab
- Der Workflow pusht nichts nach `master`. Er bricht ab, wenn Tag `vX.Y.Z` schon existiert, überspringt `npm publish`, wenn die Version schon auf npm liegt, setzt dann den Tag und legt das Release an (Rollback von Release und Tag bei Fehler). Veröffentlicht wird per npm Trusted Publishing mit Provenance

## Branch Protection

- `master` ist doppelt geschützt — klassische Branch Protection **und** ein Ruleset. Branch Protection: PR-Pflicht mit 1 Review, Required Checks `Build & Test (Node 20.x)` und `Build & Test (Node 22.x)`, Branch muss aktuell sein, lineare Historie. Ruleset: kein Löschen, kein Force-Push, PR-Pflicht
- Admins sind ausgenommen. Als Solo-Maintainer mergen: `gh pr merge <n> --squash --admin`
- Die Namen der CI-Jobs sind Required Checks: Matrix oder Job-Namen in `ci.yml` nicht ändern, ohne die Required Checks anzupassen — ein nie gemeldeter Required Check blockiert jeden PR

## Struktur

```
src/
├── index.ts, server.ts, context.ts
├── config/      schema.ts (zod, Defaults), loader.ts (.vectordb.json)
├── db/          connection.ts (VectorDB), operations.ts, schema.ts
├── embedding/   provider.ts, factory.ts, cache.ts, ollama.ts, transformers.ts, openai.ts
├── chunking/    chunker.ts, ast-chunker.ts, line-chunker.ts, languages.ts
├── indexing/    indexer.ts, pipeline.ts, file-scanner.ts, change-detector.ts
├── search/      engine.ts, bm25.ts, formatter.ts
├── tools/       schemas.ts + ein Handler pro Tool
└── utils/       paths, sanitize, retry, project-lock, git, hash, concurrency, logger
scripts/release-notes.mjs    CHANGELOG-Abschnitt -> Release-Body
test/unit, test/integration, test/helpers, test/fixtures
```
