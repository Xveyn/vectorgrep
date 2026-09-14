import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { createEmbeddingProvider } = vi.hoisted(() => ({ createEmbeddingProvider: vi.fn() }));
vi.mock("../../src/embedding/factory.js", () => ({ createEmbeddingProvider }));

import { MockEmbeddingProvider } from "../helpers/mock-embedding.js";
import { createServer } from "../../src/server.js";
import { invalidateProjectContext } from "../../src/context.js";
import { getProjectDbPath, normalizeProjectPath } from "../../src/utils/paths.js";

function failingEmbedder(): MockEmbeddingProvider {
  const embedder = new MockEmbeddingProvider(16);
  embedder.embedBatch = async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
  };
  return embedder;
}

// MCP clients decide from isError whether a tool call failed; the text alone looks like a result
describe("Integration: tool failures are flagged with isError (#35)", () => {
  const client = new Client({ name: "tool-errors-test", version: "1.0.0" });
  const projects: string[] = [];

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    await client.connect(clientTransport);
  });

  beforeEach(() => {
    createEmbeddingProvider.mockReset();
    createEmbeddingProvider.mockImplementation(async () => new MockEmbeddingProvider(16));
  });

  afterAll(async () => {
    await client.close();
    for (const projectPath of projects) {
      await invalidateProjectContext(projectPath);
      await rm(getProjectDbPath(projectPath), { recursive: true, force: true });
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  async function newProject(): Promise<string> {
    const projectPath = normalizeProjectPath(await mkdtemp(join(tmpdir(), "vectordb-tool-errors-")));
    projects.push(projectPath);
    await mkdir(join(projectPath, "src"));
    await writeFile(join(projectPath, "src/app.ts"), "export function startApp() { return 1; }\n");
    await writeFile(join(projectPath, ".vectordb.json"), JSON.stringify({ files: { gitOnly: false } }));
    return projectPath;
  }

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
    return { isError: result.isError === true, text };
  }

  it("search_code with an unknown language", async () => {
    const projectPath = await newProject();
    expect((await call("init", { projectPath })).isError).toBe(false);

    const result = await call("search_code", { projectPath, query: "start the app", language: "c++" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('Unknown language "c++"');
  });

  it("init when the embedding provider is down", async () => {
    const projectPath = await newProject();
    createEmbeddingProvider.mockImplementation(async () => failingEmbedder());

    const result = await call("init", { projectPath });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Indexing aborted");
  });

  it("reindex when the embedding provider is down", async () => {
    const projectPath = await newProject();
    await call("init", { projectPath });
    createEmbeddingProvider.mockImplementation(async () => failingEmbedder());

    const result = await call("reindex", { projectPath });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Indexing aborted");
  });

  it("index_update when the embedding provider is down", async () => {
    const projectPath = await newProject();
    await call("init", { projectPath });
    await writeFile(join(projectPath, "src/other.ts"), "export const other = 2;\n");
    createEmbeddingProvider.mockImplementation(async () => failingEmbedder());

    const result = await call("index_update", { projectPath });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Update aborted");
  });

  it("does not flag expected states: no index yet, index up to date", async () => {
    const projectPath = await newProject();

    const noIndex = await call("search_code", { projectPath, query: "start the app" });
    expect(noIndex).toMatchObject({ isError: false });
    expect(noIndex.text).toContain("No index found");

    await call("init", { projectPath });
    expect(await call("index_update", { projectPath })).toEqual({
      isError: false,
      text: "Index is up to date. No changes detected.",
    });
  });
});
