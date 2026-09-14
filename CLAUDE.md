# vectorgrep - MCP Server (Codebase Semantic Search)

## Build & Test
```bash
npm run build        # TypeScript kompilieren
npx vitest run       # Alle Tests ausfuehren
```

## MCP Registration
```bash
claude mcp add vectordb-search -- node "D:/Programme (x86)/custom_claude_code_vector_database/build/index.js"
```

## Architektur
- Entry: `src/index.ts` -> `src/server.ts` (7 MCP Tools)
- Embedding: Ollama -> transformers.js Fallback, OpenAI optional
- Chunking: Tree-sitter AST -> Line-based Fallback
- DB: LanceDB embedded, Speicherort `~/.vectordb/projects/<hash>/`
- Search: Hybrid (Vector + BM25), gewichtet nach Query-Typ

## Wichtige Konventionen
- ESM Module (.js Extensions in Imports)
- LanceDB camelCase-Spalten muessen in Filtern mit Backticks escaped werden: `` `filePath` ``, `` `symbolName` `` — doppelte Anfuehrungszeichen (`"filePath"`) werden als String-Literal gelesen, der Filter matcht dann still nie
- Aus LanceDB gelesene Vektoren sind Arrow-`Vector`s, keine Arrays — vor Weiterverwendung `Array.from()`
- Placeholder-Records (`__placeholder__`) in leeren Tables filtern
- Logging nur auf stderr (MCP nutzt stdout fuer Protocol)

---

# Verbesserungsplan

## Status-Legende
- [ ] Offen
- [x] Erledigt

## Bereits umgesetzt
- [x] Server-Level Singleton mit Init-Lock (Race Condition Fix)
- [x] LRU Embedding Cache (500 Entries)
- [x] Tree-sitter WASM Loading Fix (tree-sitter-wasms Package)
- [x] Hybrid Search (BM25 + Vector Fusion)
- [x] Score Threshold Filtering (MIN_SCORE_THRESHOLD = 0.05)
- [x] Chunk-Level Hashing fuer inkrementelle Updates (Vector-Reuse)

---

## KRITISCH - Sicherheit

### 1. SQL Injection in Search/Delete
- [x] `filePattern` in `engine.ts` — jetzt via `sanitizeFilePattern()`
- [x] `language` in `engine.ts` — jetzt via `sanitizeLanguage()` (Whitelist)
- [x] `symbolTypes` in `engine.ts` — jetzt via `sanitizeSymbolType()` (Whitelist)
- [x] `filePath` in `operations.ts` + `indexer.ts` — jetzt via `escapeSqlString()`
- **Zentrale Sanitize-Funktionen in `src/utils/sanitize.ts`**

---

## HOCH - Qualitaet & Robustheit

### 2. Retry-Logik fuer Embedding-APIs
- [x] `ollama.ts` — `embed()` und `embedBatch()` mit `withRetry()` gewrappt
- [x] `openai.ts` — `embed()` und `embedBatch()` mit `withRetry()` gewrappt
- **Zentrale Retry-Utility in `src/utils/retry.ts`** (3 Retries, Exponential Backoff 1s/2s/4s, max 8s)
- **Retries nur bei transienten Fehlern** (Netzwerk, 429, 5xx) — 4xx Client-Errors werden sofort geworfen

### 3. Transformers.js Batch-Embedding
- [x] `transformers.ts` — Native Batch-Verarbeitung statt Einzel-Calls
- **Mini-Batches a 32 Texte** um OOM zu vermeiden, Tensor-Slicing fuer Ergebnis-Extraktion

### 4. Fortschritts-Streaming bei Indexierung
- [ ] Bei 1000+ Dateien minutenlanges Warten ohne Feedback
- **Fix:** MCP Progress Notifications nutzen (SDK unterstuetzt das)

### 5. Index-Versionierung
- [ ] Schema-Aenderungen brechen alte Indices ohne Warnung
- **Fix:** Version in Metadata speichern (bereits `version: "0.1.0"`), beim Laden pruefen, Auto-Reindex bei Mismatch

---

## MITTEL - Features

### 6. Such-Ergebnis-Caching
- [ ] Identische Queries werden jedes Mal neu embedded + gesucht
- **Fix:** LRU Cache mit 30s TTL fuer komplette Search-Results

### 7. Konfigurierbarer Speicherort
- [ ] `~/.vectordb/` ist hardcoded in `paths.ts:6`
- **Fix:** `VECTORDB_PATH` Environment-Variable, Fallback auf `~/.vectordb/`

### 8. Environment Variables fuer API Keys
- [ ] OpenAI Key muss in `.vectordb.json` stehen
- **Fix:** `OPENAI_API_KEY` env var in `openai.ts` unterstuetzen

### 9. Fehler-Zusammenfassung nach Indexierung
- [ ] Fehlgeschlagene Dateien werden still uebersprungen
- **Fix:** Fehler sammeln, am Ende Summary ausgeben ("3 Dateien uebersprungen: ...")

### 10. Kontext-Laenge-Begrenzung
- [ ] Sehr lange Funktionen (500+ Zeilen) werden komplett zurueckgegeben
- **Fix:** Max-Content-Length in Search-Results, truncation mit `...` Marker

---

## NIEDRIG - Nice-to-have

### 11. Search Highlighting
- [ ] Matching-Terme im Code hervorheben (Markdown Bold/Backticks)

### 12. Score-Breakdown
- [ ] Vector-Score vs BM25-Score pro Ergebnis anzeigen (Debug-Modus)

### 13. Index-Integritaets-Check
- [ ] Korrupte LanceDB-Daten erkennen und User warnen
- **Fix:** Checksum ueber Metadata + Table Row Counts

### 14. CLI-Interface
- [ ] Index inspizieren/reparieren ohne Claude Code
- **Fix:** `npx vectorgrep status <path>`, `npx vectorgrep reindex <path>`

### 15. Metriken/Observability
- [ ] Latenz, Cache-Hit-Raten, Embedding-Kosten tracken
- **Fix:** Optional metrics in Metadata speichern, per `index_status` abrufbar
