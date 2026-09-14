import type { Table } from "@lancedb/lancedb";
import type { ChunkRecord, FileRecord } from "./schema.js";
import { escapeSqlString } from "../utils/sanitize.js";
import { logger } from "../utils/logger.js";

export interface SearchResult {
  record: ChunkRecord | FileRecord;
  distance: number;
}

export async function addChunks(table: Table, records: ChunkRecord[]): Promise<void> {
  if (records.length === 0) return;
  await table.add(records);
  logger.debug(`Added ${records.length} chunks`);
}

export async function addFiles(table: Table, records: FileRecord[]): Promise<void> {
  if (records.length === 0) return;
  await table.add(records);
  logger.debug(`Added ${records.length} files`);
}

export async function searchChunks(
  table: Table,
  queryVector: number[],
  limit: number,
  filter?: string
): Promise<SearchResult[]> {
  let query = table.search(queryVector).limit(limit);
  if (filter) {
    query = query.where(filter);
  }
  const results = await query.toArray();
  return results.map((row: any) => ({
    record: {
      id: row.id,
      vector: row.vector,
      filePath: row.filePath,
      startLine: row.startLine,
      endLine: row.endLine,
      content: row.content,
      symbolName: row.symbolName,
      symbolType: row.symbolType,
      language: row.language,
      parentSymbol: row.parentSymbol,
      summary: row.summary,
      fileHash: row.fileHash,
      indexedAt: row.indexedAt,
    } as ChunkRecord,
    distance: row._distance ?? 0,
  }));
}

export async function searchFiles(
  table: Table,
  queryVector: number[],
  limit: number
): Promise<SearchResult[]> {
  const results = await table.search(queryVector).limit(limit).toArray();
  return results.map((row: any) => ({
    record: {
      filePath: row.filePath,
      vector: row.vector,
      language: row.language,
      fileHash: row.fileHash,
      chunkCount: row.chunkCount,
      symbolCount: row.symbolCount,
      indexedAt: row.indexedAt,
    } as FileRecord,
    distance: row._distance ?? 0,
  }));
}

/**
 * Query chunks by SQL filter only (no vector search).
 * Used for exact/LIKE symbol name matching.
 */
export async function queryChunksByFilter(
  table: Table,
  filter: string,
  limit: number
): Promise<ChunkRecord[]> {
  const results = await table.query().where(filter).limit(limit).toArray();
  return results.map((row: any) => ({
    id: row.id,
    vector: row.vector,
    filePath: row.filePath,
    startLine: row.startLine,
    endLine: row.endLine,
    content: row.content,
    symbolName: row.symbolName,
    symbolType: row.symbolType,
    language: row.language,
    parentSymbol: row.parentSymbol,
    summary: row.summary,
    fileHash: row.fileHash,
    indexedAt: row.indexedAt,
  } as ChunkRecord));
}

export async function deleteByFilePath(table: Table, filePath: string): Promise<void> {
  await table.delete(`\`filePath\` = '${escapeSqlString(filePath)}'`);
}

export async function deleteByFilePaths(table: Table, filePaths: string[]): Promise<void> {
  for (const fp of filePaths) {
    await deleteByFilePath(table, fp);
  }
}

export async function countRows(table: Table, filter?: string): Promise<number> {
  return await table.countRows(filter);
}

/**
 * Read every row matching `filter`. LanceDB queries return only 10 rows unless a
 * limit is set, so the limit is the number of matching rows.
 */
export async function queryAllRows(
  table: Table,
  filter: string,
  columns?: string[]
): Promise<Record<string, unknown>[]> {
  const count = await table.countRows(filter);
  if (count === 0) return [];
  let query = table.query().where(filter).limit(count);
  if (columns) query = query.select(columns);
  return (await query.toArray()) as Record<string, unknown>[];
}
