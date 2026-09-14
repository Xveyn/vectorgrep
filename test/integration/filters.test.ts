import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { MockEmbeddingProvider } from "../helpers/mock-embedding.js";
import { LineChunker } from "../../src/chunking/line-chunker.js";
import { VectorDB } from "../../src/db/connection.js";
import { SearchEngine } from "../../src/search/engine.js";
import { Indexer } from "../../src/indexing/indexer.js";
import { deleteByFilePaths } from "../../src/db/operations.js";
import { ProjectConfigSchema } from "../../src/config/schema.js";
import { getProjectDbPath } from "../../src/utils/paths.js";
import type { ChunkRecord } from "../../src/db/schema.js";

const DIMS = 16;

function chunk(
  id: string,
  filePath: string,
  symbolName: string,
  symbolType: string,
  vector: number[]
): ChunkRecord {
  return {
    id,
    vector,
    filePath,
    startLine: 1,
    endLine: 3,
    content: `function ${symbolName}() {}`,
    symbolName,
    symbolType,
    language: "typescript",
    parentSymbol: "",
    summary: `typescript ${symbolType} ${symbolName}`,
    fileHash: "hash",
    indexedAt: new Date().toISOString(),
  };
}

async function allChunkRows(db: VectorDB): Promise<Record<string, any>[]> {
  const table = await db.getOrCreateChunksTable();
  const rows = await table.query().limit(10_000).toArray();
  return rows.filter((r) => r.id !== "__placeholder__");
}

describe("Integration: LanceDB filters on camelCase columns", () => {
  const embedder = new MockEmbeddingProvider(DIMS);
  let projectPath: string;
  let db: VectorDB;
  let engine: SearchEngine;

  beforeAll(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "vectordb-filters-"));
    db = new VectorDB(projectPath, DIMS);
    await db.connect();
    await db.dropAllTables();

    // Every record shares the query's vector, so only the filters decide what is returned
    const vector = await embedder.embed("login");
    await db.getOrCreateChunksTable([
      chunk("c1", "src/auth.ts", "login", "function", vector),
      chunk("c2", "src/session.ts", "SessionStore", "class", vector),
      chunk("c3", "lib/util.ts", "loginHelper", "function", vector),
    ]);
    engine = new SearchEngine(db, embedder);
  });

  afterAll(async () => {
    await db.close();
    await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  it("searchCode restricts results to filePattern", async () => {
    const results = await engine.searchCode("login", 10, undefined, "src/*");

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.filePath.startsWith("src/"))).toBe(true);
  });

  it("searchSymbols restricts results to symbolTypes", async () => {
    const results = await engine.searchSymbols("login", 10, ["class"]);

    expect(results.map((r) => r.symbolName)).toEqual(["SessionStore"]);
  });

  it("deleteByFilePaths removes only the given file's rows", async () => {
    const table = await db.getOrCreateChunksTable();
    await deleteByFilePaths(table, ["lib/util.ts"]);

    const paths = (await allChunkRows(db)).map((r) => r.filePath).sort();
    expect(paths).toEqual(["src/auth.ts", "src/session.ts"]);
  });
});

describe("Integration: Indexer.incrementalUpdate", () => {
  const embedder = new MockEmbeddingProvider(DIMS);
  const chunker = new LineChunker(10, 0);
  const config = ProjectConfigSchema.parse({
    files: { include: ["**/*.ts"], gitOnly: false },
  });
  const lines = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};`).join("\n");

  let projectPath: string;
  let db: VectorDB;

  beforeAll(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "vectordb-incremental-"));
    await writeFile(join(projectPath, "a.ts"), lines(25, "a"));
    await writeFile(join(projectPath, "b.ts"), lines(5, "b"));

    db = new VectorDB(projectPath, DIMS);
    await db.connect();
    await new Indexer(projectPath, db, embedder, chunker, config).fullIndex();

    // Change only the last chunk of a.ts (lines 1-20 stay identical) and delete b.ts
    await writeFile(join(projectPath, "a.ts"), lines(24, "a") + "\nexport const changed = true;");
    await unlink(join(projectPath, "b.ts"));

    const result = await new Indexer(projectPath, db, embedder, chunker, config).incrementalUpdate();
    expect(result).toMatchObject({ filesModified: 1, filesDeleted: 1 });
  });

  afterAll(async () => {
    await db.close();
    await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  it("replaces a modified file's chunks instead of duplicating them", async () => {
    const rows = (await allChunkRows(db)).filter((r) => r.filePath === "a.ts");
    const starts = rows.map((r) => r.startLine).sort((x, y) => x - y);

    expect(starts).toEqual([1, 11, 21]);
  });

  it("records the embedder's actual model in the metadata", async () => {
    const metadata = await db.loadMetadata();

    expect(metadata?.embeddingModel).toBe(embedder.model);
  });

  it("removes chunks of deleted files", async () => {
    const rows = (await allChunkRows(db)).filter((r) => r.filePath === "b.ts");

    expect(rows).toHaveLength(0);
  });

  it("stores finite vectors for reused and re-embedded chunks", async () => {
    const rows = await allChunkRows(db);

    for (const row of rows) {
      const vector = Array.from(row.vector as Iterable<number>);
      expect(vector).toHaveLength(DIMS);
      expect(vector.every(Number.isFinite)).toBe(true);
    }
  });
});
