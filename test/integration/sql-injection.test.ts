import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { MockEmbeddingProvider } from "../helpers/mock-embedding.js";
import { VectorDB } from "../../src/db/connection.js";
import { SearchEngine } from "../../src/search/engine.js";
import { deleteByFilePaths } from "../../src/db/operations.js";
import { getProjectDbPath } from "../../src/utils/paths.js";
import type { ChunkRecord } from "../../src/db/schema.js";

const DIMS = 16;

function chunk(id: string, filePath: string, vector: number[]): ChunkRecord {
  return {
    id,
    vector,
    filePath,
    startLine: 1,
    endLine: 1,
    content: "function login() {}",
    symbolName: "login",
    symbolType: "function",
    language: "typescript",
    parentSymbol: "",
    summary: "typescript function login",
    fileHash: "hash",
    indexedAt: new Date().toISOString(),
  };
}

// Filters are interpolated into DataFusion SQL; these checks run against a real
// LanceDB table to prove user input can't widen or rewrite them.
describe("Integration: user input in LanceDB filters", () => {
  const embedder = new MockEmbeddingProvider(DIMS);
  let projectPath: string;
  let db: VectorDB;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "vectordb-injection-"));
    db = new VectorDB(projectPath, DIMS);
    await db.connect();
    const vector = await embedder.embed("login");
    await db.getOrCreateChunksTable([
      chunk("c1", "src/auth.ts", vector),
      chunk("c2", "src/it's.ts", vector),
      chunk("c3", "lib/util.ts", vector),
    ]);
  });

  afterEach(async () => {
    await db.close();
    await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  async function remainingPaths(): Promise<string[]> {
    const rows = await (await db.getOrCreateChunksTable()).query().toArray();
    return rows.map((r) => r.filePath).sort();
  }

  it("a quote in filePattern can't turn the filter into a match-all", async () => {
    const engine = new SearchEngine(db, embedder);

    const results = await engine.searchCode("login", 10, undefined, "nothing%' OR '1'='1");

    expect(results).toEqual([]);
  });

  it("matches file paths that contain a quote", async () => {
    const engine = new SearchEngine(db, embedder);

    const results = await engine.searchCode("login", 10, undefined, "src/it's*");

    expect(results.map((r) => r.filePath)).toEqual(["src/it's.ts"]);
  });

  it("deleting a path with a quote removes only that path", async () => {
    await deleteByFilePaths(await db.getOrCreateChunksTable(), ["src/it's.ts"]);

    expect(await remainingPaths()).toEqual(["lib/util.ts", "src/auth.ts"]);
  });

  it("an injected path deletes nothing", async () => {
    await deleteByFilePaths(await db.getOrCreateChunksTable(), ["x' OR '1'='1"]);

    expect(await remainingPaths()).toEqual(["lib/util.ts", "src/auth.ts", "src/it's.ts"]);
  });

  it.todo("rejects an invalid language instead of silently searching without the filter (#36)");
});
