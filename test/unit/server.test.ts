import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

// Agents only see the server instructions and the tool descriptions — built-in
// Explore/Plan subagents don't even get the project's CLAUDE.md. These texts are
// what decides whether and how an agent uses vectorgrep.
describe("MCP server metadata", () => {
  const client = new Client({ name: "server-test", version: "1.0.0" });
  let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    await client.connect(clientTransport);
    tools = (await client.listTools()).tools;
  });

  afterAll(async () => {
    await client.close();
  });

  const description = (name: string) => tools.find((t) => t.name === name)?.description ?? "";

  it("sends instructions describing the workflow", () => {
    const instructions = client.getInstructions() ?? "";

    expect(instructions).toMatch(/init/);
    expect(instructions).toMatch(/index_update/);
    expect(instructions).toMatch(/grep/i);
    expect(instructions).toMatch(/absolute/i);
  });

  it("registers all seven tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "index_status",
      "index_update",
      "init",
      "reindex",
      "search_code",
      "search_files",
      "search_symbols",
    ]);
  });

  it("tells agents when to prefer semantic search over grep", () => {
    expect(description("search_code")).toMatch(/grep/i);
  });

  it("tells agents that searches need an index first", () => {
    for (const name of ["search_code", "search_files", "search_symbols"]) {
      expect(description(name), name).toMatch(/init/);
    }
  });

  it("steers routine refreshes to index_update instead of reindex", () => {
    expect(description("reindex")).toMatch(/index_update/);
    expect(description("init")).toMatch(/index_update/);
  });

  it("accepts every symbol type the chunker emits in search_symbols", async () => {
    const result = await client.callTool({
      name: "search_symbols",
      arguments: {
        projectPath: "/nonexistent/vectorgrep-server-test",
        query: "FanMode",
        symbolTypes: ["enum", "module"],
      },
    });
    const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");

    expect(result.isError).toBeFalsy();
    expect(text).toContain("No index found");
  });
});
