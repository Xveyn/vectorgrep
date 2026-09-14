import type { InitInput } from "./schemas.js";
import { loadProjectConfig } from "../config/loader.js";
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

    const config = await loadProjectConfig(projectPath);

    if (input.embeddingProvider) {
      config.embedding.provider = input.embeddingProvider;
    }
    if (input.embeddingModel) {
      config.embedding.model = input.embeddingModel;
    }
    if (input.includePatterns) {
      config.files.include = input.includePatterns;
    }
    if (input.excludePatterns) {
      config.files.exclude = [...config.files.exclude, ...input.excludePatterns];
    }

    const embedder = await createEmbeddingProvider(config.embedding);
    const chunker = new ASTChunker(config.chunking.maxChunkLines, config.chunking.overlapLines);

    const db = new VectorDB(projectPath, embedder.dimensions);
    await db.connect();

    const indexer = new Indexer(projectPath, db, embedder, chunker, config);
    const result = await indexer.fullIndex();

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
    return `Error initializing index: ${error}`;
  } finally {
    // A search that started just before the write may have cached tables from before it
    await invalidateProjectContext(projectPath);
  }
}
