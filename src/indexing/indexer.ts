import type { Table } from "@lancedb/lancedb";
import { VectorDB } from "../db/connection.js";
import { addChunks, addFiles, deleteByFilePaths, countRows, queryAllRows } from "../db/operations.js";
import type { ChunkRecord, FileRecord, ProjectMetadata } from "../db/schema.js";
import type { EmbeddingProvider } from "../embedding/provider.js";
import type { Chunker } from "../chunking/chunker.js";
import type { ProjectConfig } from "../config/schema.js";
import { scanFiles } from "./file-scanner.js";
import { detectChanges } from "./change-detector.js";
import { processFile } from "./pipeline.js";
import { promisePool } from "../utils/concurrency.js";
import { normalizeProjectPath } from "../utils/paths.js";
import { hashString } from "../utils/hash.js";
import { escapeSqlString } from "../utils/sanitize.js";
import { logger } from "../utils/logger.js";

export interface IndexResult {
  filesIndexed: number;
  chunksCreated: number;
  symbolsFound: number;
  duration: number;
  provider: string;
}

export interface UpdateResult {
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  chunksCreated: number;
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

  async fullIndex(): Promise<IndexResult> {
    const start = Date.now();
    logger.info("Starting full index", { projectPath: this.projectPath });

    // Drop existing data
    await this.db.dropAllTables();

    // Scan files
    const files = await scanFiles(this.projectPath, this.config.files);

    // Process files in parallel
    const allChunks: ChunkRecord[] = [];
    const allFiles: FileRecord[] = [];
    let symbolCount = 0;

    const batchSize = this.config.embedding.batchSize;
    const concurrency = 4;

    // Process files in batches
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const results = await promisePool(batch, concurrency, (filePath) =>
        processFile(this.projectPath, filePath, this.chunker, this.embedder)
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

    // Store in DB. Overwrite explicitly: another server process may have recreated
    // (placeholder) tables since dropAllTables(), and opening those would discard our data.
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
    };
    await this.db.saveMetadata(metadata);

    const duration = Date.now() - start;
    logger.info("Full index complete", {
      files: allFiles.length,
      chunks: allChunks.length,
      symbols: symbolCount,
      duration: `${(duration / 1000).toFixed(1)}s`,
    });

    return {
      filesIndexed: allFiles.length,
      chunksCreated: allChunks.length,
      symbolsFound: symbolCount,
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
        duration: Date.now() - start,
      };
    }

    const chunksTable = await this.db.getOrCreateChunksTable();
    const filesTable = await this.db.getOrCreateFilesTable();

    // Re-index added/modified files
    const toIndex = changes
      .filter((c) => c.status === "added" || c.status === "modified")
      .map((c) => c.filePath);

    // For modified files, load existing chunk vectors BEFORE deletion so we can reuse unchanged ones
    const modifiedFiles = new Set(
      changes.filter((c) => c.status === "modified").map((c) => c.filePath)
    );
    const existingChunkData = modifiedFiles.size > 0
      ? await this.getExistingChunkData(chunksTable, modifiedFiles)
      : new Map<string, Map<string, { summaryHash: string; vector: number[] }>>();

    // Delete removed/modified files from DB
    const toDelete = changes
      .filter((c) => c.status === "deleted" || c.status === "modified")
      .map((c) => c.filePath);

    if (toDelete.length > 0) {
      await deleteByFilePaths(chunksTable, toDelete);
      await deleteByFilePaths(filesTable, toDelete);
    }

    const allChunks: ChunkRecord[] = [];
    const allFiles: FileRecord[] = [];

    for (const filePath of toIndex) {
      const chunkCache = existingChunkData.get(filePath);
      const result = await processFile(
        this.projectPath,
        filePath,
        this.chunker,
        this.embedder,
        chunkCache
      );
      if (result) {
        allChunks.push(...result.chunks);
        allFiles.push(result.fileRecord);
      }
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
      duration,
    };
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
