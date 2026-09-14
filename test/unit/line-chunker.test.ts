import { describe, it, expect } from "vitest";
import { LineChunker } from "../../src/chunking/line-chunker.js";

describe("LineChunker", () => {
  const chunker = new LineChunker(20, 5);

  it("should create a single chunk for small files", async () => {
    const content = "line 1\nline 2\nline 3";
    const chunks = await chunker.chunk("test.ts", content, "typescript");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].filePath).toBe("test.ts");
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(3);
    expect(chunks[0].language).toBe("typescript");
    expect(chunks[0].content).toBe(content);
  });

  it("should split large files with overlap", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");
    const chunks = await chunker.chunk("big.ts", content, "typescript");

    expect(chunks.length).toBeGreaterThan(1);
    // Verify overlap: end of chunk N should overlap with start of chunk N+1
    expect(chunks[0].endLine).toBe(20);
    expect(chunks[1].startLine).toBe(16); // 20 - 5 + 1
  });

  it("should generate unique chunk IDs", async () => {
    const content = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    const chunks = await chunker.chunk("test.ts", content, "typescript");

    const ids = new Set(chunks.map((c) => c.id));
    expect(ids.size).toBe(chunks.length);
  });

  it("should include file path and line info in summary", async () => {
    const content = "function hello() {\n  return 'world';\n}";
    const chunks = await chunker.chunk("src/hello.ts", content, "typescript");

    expect(chunks[0].summary).toContain("src/hello.ts");
    expect(chunks[0].summary).toContain("typescript");
  });

  it("terminates and covers every line when overlap >= maxChunkLines", async () => {
    const content = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const chunks = await new LineChunker(10, 10).chunk("loop.ts", content, "typescript");

    expect(chunks[0].startLine).toBe(1);
    expect(chunks[chunks.length - 1].endLine).toBe(30);
    expect(chunks.length).toBeLessThanOrEqual(30);
  });
});
