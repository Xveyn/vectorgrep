import { readFile } from "fs/promises";
import { join } from "path";
import type { EmbeddingProvider } from "../embedding/provider.js";
import type { Chunker, CodeChunk } from "../chunking/chunker.js";
import type { ChunkRecord, FileRecord } from "../db/schema.js";
import { getLanguageForFile } from "../chunking/languages.js";
import { hashFile, hashString } from "../utils/hash.js";
import { logger } from "../utils/logger.js";

export interface PipelineResult {
  chunks: ChunkRecord[];
  fileRecord: FileRecord;
}

/**
 * A single file couldn't be read or chunked. Callers skip the file and report it; unlike
 * an embedding failure it says nothing about the other files.
 */
export class SkippedFileError extends Error {}

/**
 * Process a file: chunk -> embed -> build records. Returns null for files without chunks.
 * Throws SkippedFileError when the file itself can't be processed; embedding errors
 * propagate unchanged, since a failing provider affects every file.
 * @param existingChunkHashes - Optional map of chunkId -> summaryHash for skipping unchanged chunks.
 *   When provided, chunks whose summary hash matches will reuse the existing vector (set to null),
 *   and only new/changed chunks will be embedded.
 */
export async function processFile(
  projectPath: string,
  filePath: string,
  chunker: Chunker,
  embedder: EmbeddingProvider,
  existingChunkHashes?: Map<string, { summaryHash: string; vector: number[] }>
): Promise<PipelineResult | null> {
  const fullPath = join(projectPath, filePath);

  let language: string;
  let codeChunks: CodeChunk[];
  let fileHash: string;
  try {
    const content = await readFile(fullPath, "utf-8");
    language = getLanguageForFile(filePath)?.id || "unknown";
    codeChunks = await chunker.chunk(filePath, content, language);
    if (codeChunks.length === 0) return null;
    fileHash = await hashFile(fullPath);
  } catch (error) {
    throw new SkippedFileError(String(error));
  }

  const now = new Date().toISOString();

  let vectors: number[][];

  if (existingChunkHashes && existingChunkHashes.size > 0) {
    // Smart embedding: only embed chunks whose summary changed
    vectors = await embedWithChunkCache(codeChunks, embedder, existingChunkHashes);
  } else {
    // Full embedding: embed all chunks
    const summaries = codeChunks.map((c) => c.summary);
    vectors = await embedder.embedBatch(summaries);
  }

  // Build chunk records
  const chunks: ChunkRecord[] = codeChunks.map((chunk, i) => ({
    id: chunk.id,
    vector: vectors[i],
    filePath: chunk.filePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    content: chunk.content,
    symbolName: chunk.symbolName || "",
    symbolType: chunk.symbolType || "",
    language: chunk.language,
    parentSymbol: chunk.parentSymbol || "",
    summary: chunk.summary,
    fileHash,
    indexedAt: now,
  }));

  // Build file record with averaged vector
  const avgVector = averageVectors(vectors);
  const symbolCount = codeChunks.filter((c) => c.symbolName).length;

  const fileRecord: FileRecord = {
    filePath,
    vector: avgVector,
    language,
    fileHash,
    chunkCount: chunks.length,
    symbolCount,
    indexedAt: now,
  };

  return { chunks, fileRecord };
}

/**
 * Embed chunks, reusing vectors for chunks whose summary hasn't changed.
 */
async function embedWithChunkCache(
  codeChunks: CodeChunk[],
  embedder: EmbeddingProvider,
  existingChunkHashes: Map<string, { summaryHash: string; vector: number[] }>
): Promise<number[][]> {
  const vectors: number[][] = new Array(codeChunks.length);
  const toEmbedIndices: number[] = [];
  const toEmbedTexts: string[] = [];
  let reused = 0;

  for (let i = 0; i < codeChunks.length; i++) {
    const chunk = codeChunks[i];
    const currentSummaryHash = hashString(chunk.summary);
    const existing = existingChunkHashes.get(chunk.id);

    if (existing && existing.summaryHash === currentSummaryHash) {
      // Chunk content unchanged — reuse existing vector
      vectors[i] = existing.vector;
      reused++;
    } else {
      // New or changed chunk — needs embedding
      toEmbedIndices.push(i);
      toEmbedTexts.push(chunk.summary);
    }
  }

  if (toEmbedTexts.length > 0) {
    const newVectors = await embedder.embedBatch(toEmbedTexts);
    for (let j = 0; j < toEmbedIndices.length; j++) {
      vectors[toEmbedIndices[j]] = newVectors[j];
    }
  }

  if (reused > 0) {
    logger.debug(`Reused ${reused}/${codeChunks.length} chunk vectors`);
  }

  return vectors;
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0].length;
  const avg = new Array(dims).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) {
      avg[i] += vec[i];
    }
  }

  for (let i = 0; i < dims; i++) {
    avg[i] /= vectors.length;
  }

  return avg;
}
