import type { ReindexInput } from "./schemas.js";
import { loadProjectConfig } from "../config/loader.js";
import { createEmbeddingProvider } from "../embedding/factory.js";
import { ASTChunker } from "../chunking/ast-chunker.js";
import { VectorDB } from "../db/connection.js";
import { Indexer } from "../indexing/indexer.js";
import { invalidateProjectContext } from "../context.js";
import { normalizeProjectPath } from "../utils/paths.js";
import { withProjectWriteLock } from "../utils/project-lock.js";
import { logger } from "../utils/logger.js";

export async function handleReindex(input: ReindexInput): Promise<string> {
  const projectPath = normalizeProjectPath(input.projectPath);
  return withProjectWriteLock(projectPath, () => reindex(projectPath));
}

async function reindex(projectPath: string): Promise<string> {
  try {
    await invalidateProjectContext(projectPath);

    const config = await loadProjectConfig(projectPath);
    const embedder = await createEmbeddingProvider(config.embedding);
    const chunker = new ASTChunker(config.chunking.maxChunkLines, config.chunking.overlapLines);

    const db = new VectorDB(projectPath, embedder.dimensions);
    await db.connect();

    const indexer = new Indexer(projectPath, db, embedder, chunker, config);
    const result = await indexer.fullIndex();

    await db.close();

    return [
      `Reindex complete for: ${projectPath}`,
      ``,
      `Provider: ${result.provider} (${embedder.dimensions}d)`,
      `Files indexed: ${result.filesIndexed}`,
      `Chunks created: ${result.chunksCreated}`,
      `Symbols found: ${result.symbolsFound}`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
    ].join("\n");
  } catch (error) {
    logger.error("reindex failed", { error: String(error) });
    return `Error during reindex: ${error}`;
  } finally {
    // A search that started just before the write may have cached tables from before it
    await invalidateProjectContext(projectPath);
  }
}
