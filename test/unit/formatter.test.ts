import { describe, it, expect } from "vitest";
import { formatCodeResults, formatFileResults, formatSymbolResults } from "../../src/search/formatter.js";
import type { CodeSearchResult, SymbolSearchResult } from "../../src/search/engine.js";

// This text is what agents read from the search tools.

const codeResult = (overrides: Partial<CodeSearchResult> = {}): CodeSearchResult => ({
  filePath: "src/auth.ts",
  startLine: 3,
  endLine: 5,
  content: "export function login() {\n  return true;\n}",
  symbolName: "login",
  symbolType: "function",
  language: "typescript",
  score: 0.12345,
  ...overrides,
});

describe("formatCodeResults", () => {
  it("says when nothing matched", () => {
    expect(formatCodeResults([])).toBe("No matching code found.");
  });

  it("lists location, symbol and fenced code per result", () => {
    const text = formatCodeResults([codeResult()]);

    expect(text).toBe(
      [
        "Found 1 result(s):\n",
        "--- Result 1 (score: 0.123) ---",
        "File: src/auth.ts:3-5",
        "Symbol: function login",
        "Language: typescript",
        "```typescript",
        "export function login() {\n  return true;\n}",
        "```",
        "",
      ].join("\n")
    );
  });

  it("omits the symbol line for chunks without a symbol", () => {
    const text = formatCodeResults([codeResult({ symbolName: "", symbolType: "" })]);

    expect(text).not.toContain("Symbol:");
    expect(text).toContain("File: src/auth.ts:3-5");
  });

  it("numbers multiple results in order", () => {
    const text = formatCodeResults([codeResult(), codeResult({ filePath: "src/b.ts", score: 0.1 })]);

    expect(text).toMatch(/^Found 2 result\(s\):/);
    expect(text.indexOf("--- Result 1")).toBeLessThan(text.indexOf("--- Result 2"));
  });
});

describe("formatFileResults", () => {
  it("says when nothing matched", () => {
    expect(formatFileResults([])).toBe("No matching files found.");
  });

  it("lists each file with its stats", () => {
    const text = formatFileResults([
      { filePath: "src/auth.ts", language: "typescript", chunkCount: 3, symbolCount: 2, score: 0.5 },
    ]);

    expect(text).toBe(
      [
        "Found 1 file(s):\n",
        "1. **src/auth.ts** (score: 0.500)",
        "   Language: typescript | Chunks: 3 | Symbols: 2",
      ].join("\n")
    );
  });
});

describe("formatSymbolResults", () => {
  const symbol = (content: string): SymbolSearchResult => ({
    filePath: "src/box.ts",
    startLine: 10,
    endLine: 20,
    symbolName: "Box",
    symbolType: "class",
    content,
    language: "typescript",
    score: 1.35,
  });

  it("says when nothing matched", () => {
    expect(formatSymbolResults([])).toBe("No matching symbols found.");
  });

  it("shows the symbol header and a short preview without ellipsis", () => {
    const text = formatSymbolResults([symbol("class Box {\n  open() {}\n}")]);

    expect(text).toContain('--- class "Box" (score: 1.350) ---');
    expect(text).toContain("File: src/box.ts:10-20");
    expect(text).toContain("class Box {\n  open() {}\n}");
    expect(text).not.toContain("// ...");
  });

  it("cuts the preview after five lines", () => {
    const content = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n");

    const text = formatSymbolResults([symbol(content)]);

    expect(text).toContain("line 5\n  // ...");
    expect(text).not.toContain("line 6");
  });
});
