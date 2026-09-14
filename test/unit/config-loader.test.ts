import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadProjectConfig } from "../../src/config/loader.js";

describe("loadProjectConfig", () => {
  let withoutConfig: string;
  let invalidConfig: string;
  let partialConfig: string;

  beforeAll(async () => {
    withoutConfig = await mkdtemp(join(tmpdir(), "vectordb-config-none-"));
    invalidConfig = await mkdtemp(join(tmpdir(), "vectordb-config-invalid-"));
    partialConfig = await mkdtemp(join(tmpdir(), "vectordb-config-partial-"));
    await writeFile(join(invalidConfig, ".vectordb.json"), "{ not json");
    await writeFile(
      join(partialConfig, ".vectordb.json"),
      JSON.stringify({ chunking: { maxChunkLines: 50 } })
    );
  });

  afterAll(async () => {
    for (const dir of [withoutConfig, invalidConfig, partialConfig]) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["no config file", () => withoutConfig],
    ["an invalid config file", () => invalidConfig],
  ])("returns fresh defaults on every call with %s", async (_label, dir) => {
    const first = await loadProjectConfig(dir());
    first.embedding.provider = "openai";
    first.files.exclude.push("**/secret/**");

    const second = await loadProjectConfig(dir());

    expect(second).not.toBe(first);
    expect(second.embedding.provider).toBe("auto");
    expect(second.files.exclude).not.toContain("**/secret/**");
  });

  it("leaves the embedding model unset so each provider uses its own default", async () => {
    const config = await loadProjectConfig(withoutConfig);

    expect(config.embedding.model).toBeUndefined();
  });

  it("fills omitted fields of a partial config with defaults", async () => {
    const config = await loadProjectConfig(partialConfig);

    expect(config.chunking).toEqual({ maxChunkLines: 50, overlapLines: 10 });
    expect(config.search.defaultLimit).toBe(10);
  });
});
