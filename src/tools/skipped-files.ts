import type { SkippedFile } from "../indexing/indexer.js";

const MAX_LISTED = 10;

/** Output lines listing files an indexing run skipped; empty when none were skipped. */
export function formatSkippedFiles(skipped: SkippedFile[]): string[] {
  if (skipped.length === 0) return [];

  const lines = ["", `Skipped files (${skipped.length}):`];
  for (const { filePath, reason } of skipped.slice(0, MAX_LISTED)) {
    lines.push(`  ${filePath}: ${reason}`);
  }
  if (skipped.length > MAX_LISTED) {
    lines.push(`  … and ${skipped.length - MAX_LISTED} more (see server log)`);
  }
  return lines;
}
