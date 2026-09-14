import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as lancedb from "@lancedb/lancedb";

const { createEmbeddingProvider } = vi.hoisted(() => ({ createEmbeddingProvider: vi.fn() }));
vi.mock("../../src/embedding/factory.js", () => ({ createEmbeddingProvider }));

import { MockEmbeddingProvider } from "../helpers/mock-embedding.js";
import { handleInit } from "../../src/tools/init.js";
import { handleIndexUpdate } from "../../src/tools/index-update.js";
import { handleReindex } from "../../src/tools/reindex.js";
import { invalidateProjectContext } from "../../src/context.js";
import { getLanceDbPath, getProjectDbPath, normalizeProjectPath } from "../../src/utils/paths.js";

/** File paths actually stored in the index, ignoring placeholder rows. */
async function indexedFiles(projectPath: string): Promise<string[]> {
  const db = await lancedb.connect(getLanceDbPath(projectPath));
  const rows = await (await db.openTable("files")).query().limit(10_000).toArray();
  return rows.map((r) => r.filePath as string).filter((p) => p !== "__placeholder__").sort();
}

/** The embedding config the last tool call created its provider with. */
function lastEmbeddingConfig(): { provider: string; model?: string } {
  return createEmbeddingProvider.mock.calls.at(-1)![0];
}

describe("Integration: init arguments persist across index_update and reindex (#72)", () => {
  let projectPath: string;

  const writeVectordbJson = (config: object) =>
    writeFile(join(projectPath, ".vectordb.json"), JSON.stringify(config));

  beforeEach(async () => {
    createEmbeddingProvider.mockReset();
    createEmbeddingProvider.mockImplementation(async () => new MockEmbeddingProvider(16));

    projectPath = normalizeProjectPath(await mkdtemp(join(tmpdir(), "vectordb-init-patterns-")));
    await mkdir(join(projectPath, "src"));
    await mkdir(join(projectPath, "docs"));
    await writeFile(join(projectPath, "src/app.ts"), "export const app = 1;\n");
    await writeFile(join(projectPath, "docs/guide.ts"), "export const guide = 1;\n");
    await writeFile(join(projectPath, "notes.md"), "# Notes\n");
    await writeVectordbJson({ files: { gitOnly: false } });
  });

  afterEach(async () => {
    await invalidateProjectContext(projectPath);
    await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  it("index_update keeps files excluded at init out of the index", async () => {
    await handleInit({ projectPath, excludePatterns: ["docs/**"] });
    expect(await indexedFiles(projectPath)).not.toContain("docs/guide.ts");

    await writeFile(join(projectPath, "src/other.ts"), "export const other = 1;\n");
    await handleIndexUpdate({ projectPath });

    const files = await indexedFiles(projectPath);
    expect(files).toContain("src/other.ts");
    expect(files).not.toContain("docs/guide.ts");
  });

  it("reindex keeps files excluded at init out of the index", async () => {
    await handleInit({ projectPath, excludePatterns: ["docs/**"] });
    await handleReindex({ projectPath });

    expect(await indexedFiles(projectPath)).not.toContain("docs/guide.ts");
  });

  it("index_update and reindex keep the include patterns given at init", async () => {
    await handleInit({ projectPath, includePatterns: ["src/**/*.ts"] });
    expect(await indexedFiles(projectPath)).toEqual(["src/app.ts"]);

    await handleIndexUpdate({ projectPath });
    expect(await indexedFiles(projectPath)).toEqual(["src/app.ts"]);

    await handleReindex({ projectPath });
    expect(await indexedFiles(projectPath)).toEqual(["src/app.ts"]);
  });

  it("a later init without patterns resets them", async () => {
    await handleInit({ projectPath, excludePatterns: ["docs/**"] });
    await handleInit({ projectPath });
    await handleIndexUpdate({ projectPath });
    await handleReindex({ projectPath });

    expect(await indexedFiles(projectPath)).toContain("docs/guide.ts");
  });

  it("reindex keeps the embedding provider and model given at init", async () => {
    await handleInit({ projectPath, embeddingProvider: "transformers", embeddingModel: "custom-model" });
    await handleReindex({ projectPath });

    expect(lastEmbeddingConfig()).toMatchObject({ provider: "transformers", model: "custom-model" });
  });

  it("reindex without init overrides picks up embedding settings changed in .vectordb.json", async () => {
    await handleInit({ projectPath });
    await writeVectordbJson({ files: { gitOnly: false }, embedding: { provider: "ollama" } });
    await handleReindex({ projectPath });

    expect(lastEmbeddingConfig()).toMatchObject({ provider: "ollama" });
  });
});
