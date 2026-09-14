/** Schema types for LanceDB tables */

import type { InitOverrides } from "../config/init-overrides.js";

export interface ChunkRecord {
  [key: string]: unknown;
  id: string;
  vector: number[];
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  symbolName: string;
  symbolType: string;
  language: string;
  parentSymbol: string;
  summary: string;
  fileHash: string;
  indexedAt: string;
}

export interface FileRecord {
  [key: string]: unknown;
  filePath: string;
  vector: number[];
  language: string;
  fileHash: string;
  chunkCount: number;
  symbolCount: number;
  indexedAt: string;
}

export interface ProjectMetadata {
  projectPath: string;
  embeddingProvider: string;
  embeddingModel: string;
  dimensions: number;
  totalFiles: number;
  totalChunks: number;
  totalSymbols: number;
  lastIndexedAt: string;
  createdAt: string;
  version: string;
  /** Arguments of the last init; absent in indexes created before they were stored */
  initOverrides?: InitOverrides;
}
