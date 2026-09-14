import type { Table } from "@lancedb/lancedb";
import { VectorDB } from "../db/connection.js";
import { addChunks, addFiles, deleteByFilePaths, countRows, queryAllRows } from "../db/operations.js";
import type { ChunkRecord, FileRecord, ProjectMetadata } from "../db/schema.js";
import type { EmbeddingProvider } from "../embedding/provider.js";
import type { Chunker } from "../chunking/chunker.js";
import type { ProjectConfig } from "../config/schema.js";
import type { InitOverrides } from "../config/init-overrides.js";
import { scanFiles } from "./file-scanner.js";
import { detectChanges } from "./change-detector.js";
import { processFile, SkippedFileError, type PipelineResult } from "./pipeline.js";
import { promisePool } from "../utils/concurrency.js";
import { normalizeProjectPath } from "../utils/paths.js";
import { hashString } from "../utils/hash.js";
import { escapeSqlString } from "../utils/sanitize.js";
import { logger } from "../utils/logger.js";

export interface SkippedFile {
  filePath: string;
  reason: string;
}

export interface IndexResult {
  filesIndexed: number;
  chunksCreated: number;
  symbolsFound: number;
  skippedFiles: SkippedFile[];
  duration: number;
  provider: string;
}

export interface UpdateResult {
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  chunksCreated: number;
  skippedFiles: SkippedFile[];
  duration: number;
}

export class Indexer {
  private db: VectorDB;
  private embedder: EmbeddingProvider;
  private chunker: Chunker;
  private config: ProjectConfig;
  private projectPath: string;

  constructor(
    projectPath: string,
    db: VectorDB,
    embedder: EmbeddingProvider,
    chunker: Chunker,
    config: ProjectConfig
  ) {
    this.projectPath = projectPath;
    this.db = db;
    this.embedder = embedder;
    this.chunker = chunker;
    this.config = config;
  }

  /**
   * Build the index from scratch. The existing tables stay untouched until every file is
   * embedded, so a failing provider or a killed process leaves the previous index intact.
   * @param initOverrides - Arguments of the last init, stored in the metadata for later runs.
   */
  async fullIndex(initOverrides?: InitOverrides): Promise<IndexResult> {
    const start = Date.now();
    logger.info("Starting full index", { projectPath: this.projectPath });

    // Scan files
    const files = await scanFiles(this.projectPath, this.config.files);

    // Process files in parallel
    const allChunks: ChunkRecord[] = [];
    const allFiles: FileRecord[] = [];
    const skippedFiles: SkippedFile[] = [];
    let symbolCount = 0;

    const batchSize = this.config.embedding.batchSize;
    const concurrency = 4;

    try {
      // Process files in batches
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await promisePool(batch, concurrency, (filePath) =>
          this.tryProcessFile(filePath, skippedFiles)
        );

        for (const result of results) {
          if (result) {
            allChunks.push(...result.chunks);
            allFiles.push(result.fileRecord);
            symbolCount += result.fileRecord.symbolCount;
          }
        }

        logger.info(`Indexed ${Math.min(i + batchSize, files.length)}/${files.length} files`);
      }
    } catch (error) {
      throw new Error(`Indexing aborted, the existing index was not changed: ${error}`);
    }

    // Store in DB. Overwrite explicitly: another server process may have created
    // (placeholder) tables in the meantime, and opening those would discard our data.
    await this.db.overwriteChunksTable(allChunks);
    await this.db.overwriteFilesTable(allFiles);

    // Save metadata
    const metadata: ProjectMetadata = {
      projectPath: normalizeProjectPath(this.projectPath),
      embeddingProvider: this.embedder.name,
      embeddingModel: this.embedder.model,
      dimensions: this.embedder.dimensions,
      totalFiles: allFiles.length,
      totalChunks: allChunks.length,
      totalSymbols: symbolCount,
      lastIndexedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      version: "0.1.0",
      initOverrides,
    };
    await this.db.saveMetadata(metadata);

    const duration = Date.now() - start;
    logger.info("Full index complete", {
      files: allFiles.length,
      chunks: allChunks.length,
      symbols: symbolCount,
      skipped: skippedFiles.length,
      duration: `${(duration / 1000).toFixed(1)}s`,
    });

    return {
      filesIndexed: allFiles.length,
      chunksCreated: allChunks.length,
      symbolsFound: symbolCount,
      skippedFiles,
      duration,
      provider: this.embedder.name,
    };
  }

  async incrementalUpdate(): Promise<UpdateResult> {
    const start = Date.now();
    logger.info("Starting incremental update");

    // Get current files
    const currentFiles = await scanFiles(this.projectPath, this.config.files);

    // Get existing file hashes from metadata
    const existingHashes = await this.getExistingFileHashes();

    // Detect changes
    const changes = await detectChanges(this.projectPath, currentFiles, existingHashes);

    if (changes.length === 0) {
      logger.info("No changes detected");
      return {
        filesAdded: 0,
        filesModified: 0,
        filesDeleted: 0,
        chunksCreated: 0,
        skippedFiles: [],
        duration: Date.now() - start,
      };
    }

    const chunksTable = await this.db.getOrCreateChunksTable();
    const filesTable = await this.db.getOrCreateFilesTable();

    // Re-index added/modified files
    const toIndex = changes
      .filter((c) => c.status === "added" || c.status === "modified")
      .map((c) => c.filePath);

    // For modified files, load existing chunk vectors so we can reuse unchanged ones
    const modifiedFiles = new Set(
      changes.filter((c) => c.status === "modified").map((c) => c.filePath)
    );
    const existingChunkData = modifiedFiles.size > 0
      ? await this.getExistingChunkData(chunksTable, modifiedFiles)
      : new Map<string, Map<string, { summaryHash: string; vector: number[] }>>();

    // Embed before deleting anything, so a failing provider leaves the index unchanged
    const allChunks: ChunkRecord[] = [];
    const allFiles: FileRecord[] = [];
    const skippedFiles: SkippedFile[] = [];

    try {
      for (const filePath of toIndex) {
        const result = await this.tryProcessFile(filePath, skippedFiles, existingChunkData.get(filePath));
        if (result) {
          allChunks.push(...result.chunks);
          allFiles.push(result.fileRecord);
        }
      }
    } catch (error) {
      throw new Error(`Update aborted, the index was not changed: ${error}`);
    }

    // Delete removed/modified files from DB
    const toDelete = changes
      .filter((c) => c.status === "deleted" || c.status === "modified")
      .map((c) => c.filePath);

    if (toDelete.length > 0) {
      await deleteByFilePaths(chunksTable, toDelete);
      await deleteByFilePaths(filesTable, toDelete);
    }

    if (allChunks.length > 0) {
      await addChunks(chunksTable, allChunks);
    }
    if (allFiles.length > 0) {
      await addFiles(filesTable, allFiles);
    }

    // Update metadata. Recount from the tables: adjusting the old totals drifts when a
    // file fails to process, and a table that started empty still holds its placeholder row.
    const metadata = await this.db.loadMetadata();
    if (metadata) {
      metadata.lastIndexedAt = new Date().toISOString();
      metadata.totalFiles = await countRows(filesTable, "`filePath` != '__placeholder__'");
      metadata.totalChunks = await countRows(chunksTable, "id != '__placeholder__'");
      metadata.totalSymbols = await countRows(chunksTable, "`symbolName` != '' AND id != '__placeholder__'");
      await this.db.saveMetadata(metadata);
    }

    const duration = Date.now() - start;
    return {
      filesAdded: changes.filter((c) => c.status === "added").length,
      filesModified: changes.filter((c) => c.status === "modified").length,
      filesDeleted: changes.filter((c) => c.status === "deleted").length,
      chunksCreated: allChunks.length,
      skippedFiles,
      duration,
    };
  }

  /** processFile, but a file that can't be processed is recorded in `skipped` instead of failing the run. */
  private async tryProcessFile(
    filePath: string,
    skipped: SkippedFile[],
    chunkCache?: Map<string, { summaryHash: string; vector: number[] }>
  ): Promise<PipelineResult | null> {
    try {
      return await processFile(this.projectPath, filePath, this.chunker, this.embedder, chunkCache);
    } catch (error) {
      if (!(error instanceof SkippedFileError)) throw error;
      logger.warn(`Skipping file: ${filePath}`, { error: error.message });
      skipped.push({ filePath, reason: error.message });
      return null;
    }
  }

  private async getExistingChunkData(
    chunksTable: Table,
    modifiedFiles: Set<string>
  ): Promise<Map<string, Map<string, { summaryHash: string; vector: number[] }>>> {
    const result = new Map<string, Map<string, { summaryHash: string; vector: number[] }>>();

    for (const filePath of modifiedFiles) {
      const rows = await queryAllRows(
        chunksTable,
        `\`filePath\` = '${escapeSqlString(filePath)}' AND id != '__placeholder__'`,
        ["id", "summary", "vector"]
      );

      if (rows.length > 0) {
        const chunkMap = new Map<string, { summaryHash: string; vector: number[] }>();
        for (const row of rows) {
          chunkMap.set(row.id as string, {
            summaryHash: hashString((row.summary as string) || ""),
            // LanceDB returns an Arrow Vector, which doesn't support index access
            vector: Array.from(row.vector as Iterable<number>),
          });
        }
        result.set(filePath, chunkMap);
        logger.debug(`Loaded ${chunkMap.size} existing chunks for ${filePath}`);
      }
    }

    return result;
  }

  /**
   * Hashes of all indexed files. Errors propagate on purpose: with an empty map every
   * file would count as added and be indexed a second time.
   */
  private async getExistingFileHashes(): Promise<Map<string, string>> {
    const filesTable = await this.db.getOrCreateFilesTable();
    const rows = await queryAllRows(filesTable, "`filePath` != '__placeholder__'", ["filePath", "fileHash"]);
    return new Map(rows.map((row) => [row.filePath as string, row.fileHash as string]));
  }
}
