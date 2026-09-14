import type { InitInput } from "./schemas.js";
import { loadProjectConfig } from "../config/loader.js";
import { applyInitOverrides, type InitOverrides } from "../config/init-overrides.js";
import { createEmbeddingProvider } from "../embedding/factory.js";
import { ASTChunker } from "../chunking/ast-chunker.js";
import { VectorDB } from "../db/connection.js";
import { Indexer } from "../indexing/indexer.js";
import { invalidateProjectContext } from "../context.js";
import { normalizeProjectPath } from "../utils/paths.js";
import { withProjectWriteLock } from "../utils/project-lock.js";
import { logger } from "../utils/logger.js";
import { formatSkippedFiles } from "./skipped-files.js";

export async function handleInit(input: InitInput): Promise<string> {
  const projectPath = normalizeProjectPath(input.projectPath);
  logger.info("Initializing index", { projectPath });
  return withProjectWriteLock(projectPath, () => initIndex(input, projectPath));
}

async function initIndex(input: InitInput, projectPath: string): Promise<string> {
  try {
    // Invalidate any cached context for this project
    await invalidateProjectContext(projectPath);

    // Stored in the metadata, so index_update and reindex keep them until the next init
    const overrides: InitOverrides = {
      embeddingProvider: input.embeddingProvider,
      embeddingModel: input.embeddingModel,
      includePatterns: input.includePatterns,
      excludePatterns: input.excludePatterns,
    };
    const config = applyInitOverrides(await loadProjectConfig(projectPath), overrides);

    const embedder = await createEmbeddingProvider(config.embedding);
    const chunker = new ASTChunker(config.chunking.maxChunkLines, config.chunking.overlapLines);

    const db = new VectorDB(projectPath, embedder.dimensions);
    await db.connect();

    const indexer = new Indexer(projectPath, db, embedder, chunker, config);
    const result = await indexer.fullIndex(overrides);

    await db.close();

    return [
      `Index initialized successfully for: ${projectPath}`,
      ``,
      `Provider: ${result.provider} (${embedder.dimensions}d)`,
      `Files indexed: ${result.filesIndexed}`,
      `Chunks created: ${result.chunksCreated}`,
      `Symbols found: ${result.symbolsFound}`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
      ...formatSkippedFiles(result.skippedFiles),
    ].join("\n");
  } catch (error) {
    logger.error("Init failed", { error: String(error) });
    // Thrown, not returned: the MCP SDK turns it into a result with isError: true
    throw new Error(`Error initializing index: ${error}`);
  } finally {
    // A search that started just before the write may have cached tables from before it
    await invalidateProjectContext(projectPath);
  }
}
