import type { Chunker, CodeChunk } from "./chunker.js";
import { hashString } from "../utils/hash.js";

/**
 * Split the inclusive, 1-based line range [firstLine, lastLine] into windows of
 * at most maxLines lines that overlap by overlapLines.
 */
export function lineWindows(
  firstLine: number,
  lastLine: number,
  maxLines: number,
  overlapLines: number
): Array<[number, number]> {
  // An overlap of maxLines or more would never advance, so always move at least one line
  const step = Math.max(1, maxLines - overlapLines);
  const windows: Array<[number, number]> = [];

  for (let start = firstLine; ; start += step) {
    const end = Math.min(start + maxLines - 1, lastLine);
    windows.push([start, end]);
    if (end >= lastLine) return windows;
  }
}

export class LineChunker implements Chunker {
  private maxChunkLines: number;
  private overlapLines: number;

  constructor(maxChunkLines = 100, overlapLines = 10) {
    this.maxChunkLines = maxChunkLines;
    this.overlapLines = overlapLines;
  }

  async chunk(filePath: string, content: string, language: string): Promise<CodeChunk[]> {
    const lines = content.split("\n");
    return this.chunkLines(filePath, lines, 1, lines.length, language);
  }

  /** Chunk lines firstLine..lastLine (1-based, inclusive) of a file's lines. */
  chunkLines(
    filePath: string,
    lines: string[],
    firstLine: number,
    lastLine: number,
    language: string
  ): CodeChunk[] {
    return lineWindows(firstLine, lastLine, this.maxChunkLines, this.overlapLines).map(
      ([start, end]) => this.createChunk(filePath, lines.slice(start - 1, end), start, end, language)
    );
  }

  private createChunk(
    filePath: string,
    lines: string[],
    startLine: number,
    endLine: number,
    language: string
  ): CodeChunk {
    const content = lines.join("\n");
    const id = hashString(`${filePath}:${startLine}:${endLine}`);

    // Create a summary from first meaningful lines
    const meaningfulLines = lines
      .filter((l) => l.trim().length > 0)
      .slice(0, 5)
      .join(" ")
      .slice(0, 200);

    return {
      id,
      filePath,
      startLine,
      endLine,
      content,
      language,
      summary: `${language} code in ${filePath} (lines ${startLine}-${endLine}): ${meaningfulLines}`,
    };
  }
}
