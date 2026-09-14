import { describe, it, expect, beforeAll } from "vitest";
import { ASTChunker } from "../../src/chunking/ast-chunker.js";
import type { CodeChunk } from "../../src/chunking/chunker.js";

const MAX_LINES = 20;

const source = [
  "import { createApp } from './app';", // 1
  "",
  "const app = createApp();", // 3
  "app.use(middleware);", // 4
  "",
  "export function bootstrap() {", // 6
  ...Array.from({ length: 50 }, (_, i) => `  step${i}();`), // 7-56
  "}", // 57
  "",
  "class Box { open() { return 1; } }", // 59
  "",
  "app.listen(3000);", // 61
].join("\n");

function uncoveredNonBlankLines(text: string, chunks: CodeChunk[]): number[] {
  const covered = new Set<number>();
  for (const c of chunks) {
    for (let line = c.startLine; line <= c.endLine; line++) covered.add(line);
  }
  return text
    .split("\n")
    .map((content, i) => ({ content, line: i + 1 }))
    .filter(({ content, line }) => content.trim().length > 0 && !covered.has(line))
    .map(({ line }) => line);
}

describe("ASTChunker", () => {
  let chunks: CodeChunk[];

  beforeAll(async () => {
    chunks = await new ASTChunker(MAX_LINES, 5).chunk("src/main.ts", source, "typescript");
  });

  it("covers every non-blank line", () => {
    expect(uncoveredNonBlankLines(source, chunks)).toEqual([]);
  });

  it("splits oversized functions into parts that keep the symbol", () => {
    const parts = chunks.filter((c) => c.symbolName === "bootstrap");

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((c) => c.symbolType === "function")).toBe(true);
    expect(parts.every((c) => c.endLine - c.startLine + 1 <= MAX_LINES)).toBe(true);
    expect(Math.min(...parts.map((c) => c.startLine))).toBe(6);
    expect(Math.max(...parts.map((c) => c.endLine))).toBe(57);
  });

  it("indexes top-level statements outside of declarations", () => {
    expect(chunks.some((c) => c.content.includes("app.use(middleware);"))).toBe(true);
    expect(chunks.some((c) => c.content.includes("app.listen(3000);"))).toBe(true);
  });

  it("gives a class and its method on the same line distinct ids", () => {
    const onSameLine = chunks.filter((c) => c.startLine === 59 && c.symbolName);

    expect(onSameLine.map((c) => c.symbolName).sort()).toEqual(["Box", "open"]);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });
});
