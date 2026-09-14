import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as lancedb from "@lancedb/lancedb";

vi.mock("../../src/embedding/factory.js", async () => {
  const { MockEmbeddingProvider } = await import("../helpers/mock-embedding.js");
  return { createEmbeddingProvider: async () => new MockEmbeddingProvider(16) };
});

import { MockEmbeddingProvider } from "../helpers/mock-embedding.js";
import { handleInit } from "../../src/tools/init.js";
import { handleIndexUpdate } from "../../src/tools/index-update.js";
import { invalidateProjectContext } from "../../src/context.js";
import { VectorDB } from "../../src/db/connection.js";
import { Indexer } from "../../src/indexing/indexer.js";
import { ASTChunker } from "../../src/chunking/ast-chunker.js";
import { ProjectConfigSchema } from "../../src/config/schema.js";
import { getLanceDbPath, getProjectDbPath, normalizeProjectPath } from "../../src/utils/paths.js";

const moduleText = (i: number, extra = "") =>
  [
    `export function computeTemperature${i}(celsius: number): number {`,
    `  return celsius * ${i + 1};`,
    `}`,
    `export class FanController${i} {`,
    `  adjustSpeed(temperature: number): number { return temperature > ${40 + i} ? 100 : 30; }`,
    `}`,
    extra,
  ].join("\n");

async function writeModules(projectPath: string, from: number, to: number) {
  for (let i = from; i < to; i++) await writeFile(join(projectPath, `src/mod${i}.ts`), moduleText(i));
}

/** What is actually stored, ignoring placeholder rows. */
async function storedCounts(projectPath: string) {
  const db = await lancedb.connect(getLanceDbPath(projectPath));
  const chunks = (await (await db.openTable("chunks")).query().limit(1_000_000).toArray()).filter(
    (r) => r.id !== "__placeholder__"
  );
  const files = (await (await db.openTable("files")).query().limit(1_000_000).toArray()).filter(
    (r) => r.filePath !== "__placeholder__"
  );
  return { files: files.length, chunks: chunks.length, symbols: chunks.filter((c) => c.symbolName).length };
}

async function metadataCounts(projectPath: string) {
  const metadata = await new VectorDB(projectPath, 0).loadMetadata();
  return { files: metadata?.totalFiles, chunks: metadata?.totalChunks, symbols: metadata?.totalSymbols };
}

describe("Integration: index_update bookkeeping", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = normalizeProjectPath(await mkdtemp(join(tmpdir(), "vectordb-update-meta-")));
    await mkdir(join(projectPath, "src"));
    await writeFile(
      join(projectPath, ".vectordb.json"),
      JSON.stringify({ files: { include: ["src/**/*.ts"], gitOnly: false } })
    );
  });

  afterEach(async () => {
    await invalidateProjectContext(projectPath);
    await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  it("keeps the metadata counters in sync with the tables", async () => {
    await writeModules(projectPath, 0, 25);
    await handleInit({ projectPath });

    await writeModules(projectPath, 25, 28); // 3 added
    await writeFile(join(projectPath, "src/mod0.ts"), moduleText(0, "export function extraHelper() {}"));
    await writeFile(join(projectPath, "src/mod1.ts"), moduleText(1, "export function otherHelper() {}"));
    await unlink(join(projectPath, "src/mod24.ts")); // 1 deleted
    await handleIndexUpdate({ projectPath });

    const stored = await storedCounts(projectPath);
    expect(stored.files).toBe(27);
    expect(await metadataCounts(projectPath)).toEqual(stored);
  });

  it("does not count the placeholder row of a table that started empty", async () => {
    await handleInit({ projectPath }); // no files yet → placeholder rows
    await writeModules(projectPath, 0, 2);
    await handleIndexUpdate({ projectPath });

    expect(await metadataCounts(projectPath)).toEqual(await storedCounts(projectPath));
  });

  it("sees every indexed file, beyond LanceDB's default query limit of 10 rows", async () => {
    await writeModules(projectPath, 0, 30);
    await handleInit({ projectPath });

    expect(await handleIndexUpdate({ projectPath })).toBe("Index is up to date. No changes detected.");
  });

  it("fails instead of re-adding every file when the existing hashes can't be read", async () => {
    await writeModules(projectPath, 0, 5);
    await handleInit({ projectPath });
    await writeModules(projectPath, 5, 6);

    const db = new VectorDB(projectPath, 16);
    await db.connect();
    vi.spyOn(db, "getOrCreateFilesTable").mockRejectedValueOnce(new Error("files table unreadable"));
    const config = ProjectConfigSchema.parse({ files: { include: ["src/**/*.ts"], gitOnly: false } });
    const indexer = new Indexer(projectPath, db, new MockEmbeddingProvider(16), new ASTChunker(), config);

    await expect(indexer.incrementalUpdate()).rejects.toThrow("files table unreadable");
    expect((await storedCounts(projectPath)).files).toBe(5);
  });
});
