import type { IndexUpdateInput } from "./schemas.js";
import { loadProjectConfig } from "../config/loader.js";
import { applyInitOverrides } from "../config/init-overrides.js";
import { createEmbeddingProvider } from "../embedding/factory.js";
import { ASTChunker } from "../chunking/ast-chunker.js";
import { VectorDB } from "../db/connection.js";
import { Indexer } from "../indexing/indexer.js";
import { invalidateProjectContext } from "../context.js";
import { normalizeProjectPath } from "../utils/paths.js";
import { withProjectWriteLock } from "../utils/project-lock.js";
import { logger } from "../utils/logger.js";
import { formatSkippedFiles } from "./skipped-files.js";

export async function handleIndexUpdate(input: IndexUpdateInput): Promise<string> {
  const projectPath = normalizeProjectPath(input.projectPath);
  return withProjectWriteLock(projectPath, () => updateIndex(projectPath));
}

async function updateIndex(projectPath: string): Promise<string> {
  try {
    const config = await loadProjectConfig(projectPath);

    const tempDb = new VectorDB(projectPath, 0);
    await tempDb.connect();
    const metadata = await tempDb.loadMetadata();
    await tempDb.close();

    if (!metadata) {
      return "No index found. Run 'init' first to create the vector index.";
    }

    applyInitOverrides(config, metadata.initOverrides);
    // The stored vectors were created with this provider and model, so new ones must match
    config.embedding.provider = metadata.embeddingProvider as any;
    config.embedding.model = metadata.embeddingModel;
    const embedder = await createEmbeddingProvider(config.embedding);

    const chunker = new ASTChunker(config.chunking.maxChunkLines, config.chunking.overlapLines);

    const db = new VectorDB(projectPath, embedder.dimensions);
    await db.connect();

    const indexer = new Indexer(projectPath, db, embedder, chunker, config);
    const result = await indexer.incrementalUpdate();

    await db.close();

    if (result.filesAdded === 0 && result.filesModified === 0 && result.filesDeleted === 0) {
      return "Index is up to date. No changes detected.";
    }

    return [
      `Incremental update complete for: ${projectPath}`,
      ``,
      `Files added:    ${result.filesAdded}`,
      `Files modified: ${result.filesModified}`,
      `Files deleted:  ${result.filesDeleted}`,
      `Chunks created: ${result.chunksCreated}`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
      ...formatSkippedFiles(result.skippedFiles),
    ].join("\n");
  } catch (error) {
    logger.error("index_update failed", { error: String(error) });
    // Thrown, not returned: the MCP SDK turns it into a result with isError: true
    throw new Error(`Error during incremental update: ${error}`);
  } finally {
    // Invalidate cached context so the next search picks up new data
    await invalidateProjectContext(projectPath);
  }
}
