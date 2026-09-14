import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as lancedb from "@lancedb/lancedb";
import { MockEmbeddingProvider } from "../helpers/mock-embedding.js";
import { LineChunker } from "../../src/chunking/line-chunker.js";
import { VectorDB } from "../../src/db/connection.js";
import { Indexer } from "../../src/indexing/indexer.js";
import { ProjectConfigSchema } from "../../src/config/schema.js";
import { getLanceDbPath, getProjectDbPath } from "../../src/utils/paths.js";

const DIMS = 16;
const config = ProjectConfigSchema.parse({ files: { include: ["**/*.ts"], gitOnly: false } });

// Read through a fresh connection so assertions see what is actually persisted. Uses
// LanceDB directly: VectorDB.getOrCreateChunksTable would create a table if it is missing.
async function persistedChunkCount(projectPath: string): Promise<number> {
  const conn = await lancedb.connect(getLanceDbPath(projectPath));
  if (!(await conn.tableNames()).includes("chunks")) return 0;
  const table = await conn.openTable("chunks");
  const rows = await table.query().limit(10_000).toArray();
  return rows.filter((r) => r.id !== "__placeholder__").length;
}

describe("Integration: Indexer.fullIndex keeps the existing index when indexing fails (#31)", () => {
  let projectPath: string;
  let db: VectorDB;
  let oldChunks: number;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "vectordb-fullindex-fail-"));
    const lines = (tag: string) =>
      Array.from({ length: 25 }, (_, i) => `export const ${tag}${i} = ${i};`).join("\n");
    for (const tag of ["a", "b", "c", "d"]) {
      await writeFile(join(projectPath, `${tag}.ts`), lines(tag));
    }

    db = new VectorDB(projectPath, DIMS);
    await db.connect();
    await new Indexer(projectPath, db, new MockEmbeddingProvider(DIMS), new LineChunker(10, 0), config).fullIndex();
    oldChunks = await persistedChunkCount(projectPath);
    expect(oldChunks).toBeGreaterThan(0);
  });

  afterEach(async () => {
    await db.close();
    await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  it("fails and keeps the old index when the embedding provider is down", async () => {
    const embedder = new MockEmbeddingProvider(DIMS);
    embedder.embedBatch = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    };

    await expect(
      new Indexer(projectPath, db, embedder, new LineChunker(10, 0), config).fullIndex()
    ).rejects.toThrow();
    expect(await persistedChunkCount(projectPath)).toBe(oldChunks);
  });

  it("fails and keeps the old index when the provider stops midway", async () => {
    const embedder = new MockEmbeddingProvider(DIMS);
    const embedBatch = embedder.embedBatch.bind(embedder);
    let calls = 0;
    embedder.embedBatch = async (texts: string[]) => {
      if (++calls > 1) throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      return embedBatch(texts);
    };
    const smallBatches = ProjectConfigSchema.parse({
      files: { include: ["**/*.ts"], gitOnly: false },
      embedding: { batchSize: 1 },
    });

    await expect(
      new Indexer(projectPath, db, embedder, new LineChunker(10, 0), smallBatches).fullIndex()
    ).rejects.toThrow();
    expect(await persistedChunkCount(projectPath)).toBe(oldChunks);
  });

  it("keeps the old index readable while embedding is in progress", async () => {
    // If the process is killed at this point, whatever is on disk is what remains
    const embedder = new MockEmbeddingProvider(DIMS);
    const embedBatch = embedder.embedBatch.bind(embedder);
    let chunksDuringEmbedding: number | undefined;
    embedder.embedBatch = async (texts: string[]) => {
      chunksDuringEmbedding ??= await persistedChunkCount(projectPath);
      return embedBatch(texts);
    };

    await new Indexer(projectPath, db, embedder, new LineChunker(10, 0), config).fullIndex();
    expect(chunksDuringEmbedding).toBe(oldChunks);
  });

  it("skips a file that can't be processed and reports it", async () => {
    const chunker = new LineChunker(10, 0);
    const chunk = chunker.chunk.bind(chunker);
    chunker.chunk = async (filePath, content, language) => {
      if (filePath === "b.ts") throw new Error("EACCES: permission denied");
      return chunk(filePath, content, language);
    };

    const result = await new Indexer(projectPath, db, new MockEmbeddingProvider(DIMS), chunker, config).fullIndex();

    expect(result.filesIndexed).toBe(3);
    expect(result.skippedFiles).toEqual([{ filePath: "b.ts", reason: "Error: EACCES: permission denied" }]);
  });
});

describe("Integration: Indexer.incrementalUpdate keeps the index when embedding fails", () => {
  let projectPath: string;
  let db: VectorDB;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "vectordb-update-fail-"));
    await writeFile(join(projectPath, "a.ts"), "export const a = 1;\n");
    db = new VectorDB(projectPath, DIMS);
    await db.connect();
    await new Indexer(projectPath, db, new MockEmbeddingProvider(DIMS), new LineChunker(10, 0), config).fullIndex();
  });

  afterEach(async () => {
    await db.close();
    await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  it("fails without removing modified files from the index", async () => {
    const oldChunks = await persistedChunkCount(projectPath);
    await writeFile(join(projectPath, "a.ts"), "export const a = 2;\n");
    const embedder = new MockEmbeddingProvider(DIMS);
    embedder.embedBatch = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    };

    await expect(
      new Indexer(projectPath, db, embedder, new LineChunker(10, 0), config).incrementalUpdate()
    ).rejects.toThrow("ECONNREFUSED");
    expect(await persistedChunkCount(projectPath)).toBe(oldChunks);
  });
});
