import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../src/embedding/factory.js", async () => {
  const { MockEmbeddingProvider } = await import("../helpers/mock-embedding.js");
  return { createEmbeddingProvider: async () => new MockEmbeddingProvider(16) };
});

import { handleInit } from "../../src/tools/init.js";
import { handleReindex } from "../../src/tools/reindex.js";
import { handleIndexStatus } from "../../src/tools/index-status.js";
import { handleSearchFiles } from "../../src/tools/search-files.js";
import { handleSearchSymbols } from "../../src/tools/search-symbols.js";
import { invalidateProjectContext } from "../../src/context.js";
import { getProjectDbPath, normalizeProjectPath } from "../../src/utils/paths.js";

const FILES = 12;

const moduleText = (i: number) =>
  [
    `export function computeTemperature${i}(celsius: number): number {`,
    `  return celsius * ${i + 1};`,
    `}`,
    `export class FanController${i} {`,
    `  adjustSpeed(temperature: number): number { return temperature > ${40 + i} ? 100 : 30; }`,
    `}`,
  ].join("\n");

/** Symbol headers in search_symbols output, e.g. `class "FanController7"` */
const symbolHeaders = (text: string) =>
  [...text.matchAll(/^--- (\w*) "([^"]*)" \(score/gm)].map((m) => `${m[1]} ${m[2]}`);

describe("Integration: tool handlers", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = normalizeProjectPath(await mkdtemp(join(tmpdir(), "vectordb-tools-")));
    await mkdir(join(projectPath, "src"));
    for (let i = 0; i < FILES; i++) {
      await writeFile(join(projectPath, `src/mod${i}.ts`), moduleText(i));
    }
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

  describe("without an index", () => {
    it.each([
      ["index_status", () => handleIndexStatus({ projectPath })],
      ["search_files", () => handleSearchFiles({ projectPath, query: "temperature" })],
      ["search_symbols", () => handleSearchSymbols({ projectPath, query: "FanController1" })],
    ])("%s tells the agent to run init", async (_tool, call) => {
      const text = await call();

      expect(text).toContain(`No index found for: ${projectPath}`);
      expect(text).toContain("Run 'init'");
    });
  });

  describe("with an index", () => {
    beforeEach(async () => {
      await handleInit({ projectPath });
    });

    it("index_status reports counts, provider and model", async () => {
      const text = await handleIndexStatus({ projectPath });

      expect(text).toContain(`Index Status for: ${projectPath}`);
      expect(text).toMatch(new RegExp(`Files indexed:\\s+${FILES}\\b`));
      expect(text).toContain("Embedding:        mock / mock-model");
      expect(text).toContain("Dimensions:       16");
    });

    it("search_files ranks the file whose path matches the query first", async () => {
      // limit high enough that every file is a vector candidate for re-ranking
      const text = await handleSearchFiles({ projectPath, query: "mod7", limit: 20 });

      expect(text).toMatch(/^Found \d+ file\(s\):/);
      expect(text.split("\n")[2]).toContain("**src/mod7.ts**");
    });

    it("search_symbols puts the exact name match first", async () => {
      const text = await handleSearchSymbols({ projectPath, query: "FanController7" });

      expect(symbolHeaders(text)[0]).toBe("class FanController7");
    });

    it("search_symbols respects symbolTypes", async () => {
      const text = await handleSearchSymbols({ projectPath, query: "computeTemperature3", symbolTypes: ["function"] });
      const headers = symbolHeaders(text);

      expect(headers[0]).toBe("function computeTemperature3");
      expect(headers.every((h) => h.startsWith("function "))).toBe(true);
    });

    it("reindex rebuilds the index so new symbols become searchable", async () => {
      await writeFile(join(projectPath, "src/extra.ts"), "export class ThermalThrottle {}\n");

      const text = await handleReindex({ projectPath });

      expect(text).toContain(`Reindex complete for: ${projectPath}`);
      expect(text).toMatch(new RegExp(`Files indexed: ${FILES + 1}\\b`));
      expect(symbolHeaders(await handleSearchSymbols({ projectPath, query: "ThermalThrottle" }))[0]).toBe(
        "class ThermalThrottle"
      );
    });
  });
});
