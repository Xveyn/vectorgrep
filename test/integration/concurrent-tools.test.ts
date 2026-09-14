import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as lancedb from "@lancedb/lancedb";

// Parallel subagents share one MCP server process, so tool handlers run
// concurrently. A slow mock embedder makes the calls actually overlap.
vi.mock("../../src/embedding/factory.js", async () => {
  const { MockEmbeddingProvider } = await import("../helpers/mock-embedding.js");
  class SlowMockEmbeddingProvider extends MockEmbeddingProvider {
    async embedBatch(texts: string[]): Promise<number[][]> {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return super.embedBatch(texts);
    }
  }
  return { createEmbeddingProvider: async () => new SlowMockEmbeddingProvider(16) };
});

import { handleInit } from "../../src/tools/init.js";
import { handleIndexUpdate } from "../../src/tools/index-update.js";
import { handleSearchCode } from "../../src/tools/search-code.js";
import { invalidateProjectContext } from "../../src/context.js";
import { getLanceDbPath, getProjectDbPath, normalizeProjectPath } from "../../src/utils/paths.js";

const moduleText = (i: number, revision = 0) =>
  [
    `export function computeTemperature${i}(celsius: number): number {`,
    `  return celsius * ${i + 1} + ${revision};`,
    `}`,
    `export class FanController${i} {`,
    `  adjustSpeed(temperature: number): number { return temperature > ${40 + i} ? 100 : 30; }`,
    `}`,
  ].join("\n");

async function writeModules(projectPath: string, from: number, to: number, revision = 0) {
  for (let i = from; i < to; i++) {
    await writeFile(join(projectPath, `src/mod${i}.ts`), moduleText(i, revision));
  }
}

async function tableRows(projectPath: string, table: "chunks" | "files") {
  const db = await lancedb.connect(getLanceDbPath(projectPath));
  const rows = await (await db.openTable(table)).query().limit(100_000).toArray();
  return rows.filter((r) => r.id !== "__placeholder__" && r.filePath !== "__placeholder__");
}

describe("Integration: concurrent tool calls on one server", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = normalizeProjectPath(await mkdtemp(join(tmpdir(), "vectordb-concurrent-")));
    await mkdir(join(projectPath, "src"));
    await writeModules(projectPath, 0, 40);
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

  it("parallel index_update calls with added files create no duplicates", async () => {
    await handleInit({ projectPath });
    await writeModules(projectPath, 40, 55);

    await Promise.all([handleIndexUpdate({ projectPath }), handleIndexUpdate({ projectPath })]);

    const files = await tableRows(projectPath, "files");
    const chunks = await tableRows(projectPath, "chunks");
    expect(files).toHaveLength(55);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it("parallel index_update calls with modified files both succeed", async () => {
    await handleInit({ projectPath });
    await writeModules(projectPath, 0, 10, 1);

    // A failing call throws, which rejects Promise.all and fails the test
    await Promise.all([handleIndexUpdate({ projectPath }), handleIndexUpdate({ projectPath })]);

    expect(await tableRows(projectPath, "files")).toHaveLength(40);
  });

  it("a search started during init returns the finished index", async () => {
    const init = handleInit({ projectPath });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const duringInit = handleSearchCode({ projectPath, query: "computeTemperature7", limit: 3 });
    await init;

    expect(await duringInit).toMatch(/^Found \d+ result/);
    expect(await handleSearchCode({ projectPath, query: "computeTemperature7", limit: 3 })).toMatch(
      /^Found \d+ result/
    );
  });

  it("searching a project without an index says so and creates no tables", async () => {
    const result = await handleSearchCode({ projectPath, query: "anything" });

    expect(result).toContain("No index found");
    const db = await lancedb.connect(getLanceDbPath(projectPath));
    expect(await db.tableNames()).toEqual([]);
  });
});
