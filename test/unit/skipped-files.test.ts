import { describe, it, expect } from "vitest";
import { formatSkippedFiles } from "../../src/tools/skipped-files.js";

describe("formatSkippedFiles", () => {
  it("returns nothing when no file was skipped", () => {
    expect(formatSkippedFiles([])).toEqual([]);
  });

  it("lists each skipped file with its reason", () => {
    expect(formatSkippedFiles([{ filePath: "src/a.ts", reason: "Error: EACCES" }])).toEqual([
      "",
      "Skipped files (1):",
      "  src/a.ts: Error: EACCES",
    ]);
  });

  it("truncates long lists", () => {
    const skipped = Array.from({ length: 12 }, (_, i) => ({ filePath: `f${i}.ts`, reason: "boom" }));
    const lines = formatSkippedFiles(skipped);

    expect(lines[1]).toBe("Skipped files (12):");
    expect(lines).toHaveLength(2 + 10 + 1);
    expect(lines.at(-1)).toBe("  … and 2 more (see server log)");
  });
});
