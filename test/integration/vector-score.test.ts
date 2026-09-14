import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { MockEmbeddingProvider } from "../helpers/mock-embedding.js";
import { VectorDB } from "../../src/db/connection.js";
import { SearchEngine } from "../../src/search/engine.js";
import { getProjectDbPath } from "../../src/utils/paths.js";
import type { ChunkRecord, FileRecord } from "../../src/db/schema.js";

const DIMS = 16;
// Natural-language query without any term from the records, so BM25 contributes nothing
// and a result's score is exactly VECTOR_WEIGHT * its vector similarity.
const QUERY = "zebra quantum orchestra";
const VECTOR_WEIGHT = 0.7;

/** Unit vector at `degrees` from the query vector, which points along the first axis. */
function unitVector(degrees: number): number[] {
  const v = new Array(DIMS).fill(0);
  v[0] = Math.cos((degrees * Math.PI) / 180);
  v[1] = Math.sin((degrees * Math.PI) / 180);
  return v;
}

const ANGLES: Record<string, number> = { identical: 0, similar: 45, orthogonal: 90, opposite: 180 };

function chunk(name: string, vector: number[]): ChunkRecord {
  return {
    id: name,
    vector,
    filePath: `src/${name}.ts`,
    startLine: 1,
    endLine: 1,
    content: `const ${name} = 1;`,
    symbolName: name,
    symbolType: "variable",
    language: "typescript",
    parentSymbol: "",
    summary: name,
    fileHash: "hash",
    indexedAt: new Date().toISOString(),
  };
}

function file(name: string, vector: number[]): FileRecord {
  return {
    filePath: `src/${name}.ts`,
    vector,
    language: "typescript",
    fileHash: "hash",
    chunkCount: 1,
    symbolCount: 1,
    indexedAt: new Date().toISOString(),
  };
}

describe("Integration: vector scores are cosine similarities (#29)", () => {
  let projectPath: string;
  let db: VectorDB;
  let engine: SearchEngine;

  beforeAll(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "vectordb-vector-score-"));
    db = new VectorDB(projectPath, DIMS);
    await db.connect();
    await db.getOrCreateChunksTable(Object.entries(ANGLES).map(([name, deg]) => chunk(name, unitVector(deg))));
    await db.getOrCreateFilesTable(Object.entries(ANGLES).map(([name, deg]) => file(name, unitVector(deg))));

    const embedder = new MockEmbeddingProvider(DIMS);
    embedder.embed = async () => unitVector(0);
    engine = new SearchEngine(db, embedder);
  });

  afterAll(async () => {
    await db.close();
    await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  const expectedScore = (degrees: number) => VECTOR_WEIGHT * Math.cos((degrees * Math.PI) / 180);

  it.each([
    ["searchCode", () => engine.searchCode(QUERY, 10)],
    ["searchSymbols", () => engine.searchSymbols(QUERY, 10)],
    ["searchFilesByQuery", () => engine.searchFilesByQuery(QUERY, 10)],
  ])("%s scores a chunk at 45° by its cosine similarity", async (_name, search) => {
    const results = await search();
    const similar = results.find((r) => r.filePath === "src/similar.ts");

    expect(similar?.score).toBeCloseTo(expectedScore(45), 3);
  });

  it.each([
    ["searchCode", () => engine.searchCode(QUERY, 10)],
    ["searchSymbols", () => engine.searchSymbols(QUERY, 10)],
    ["searchFilesByQuery", () => engine.searchFilesByQuery(QUERY, 10)],
  ])("%s keeps every score within [0, 1]", async (_name, search) => {
    const results = await search();

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
