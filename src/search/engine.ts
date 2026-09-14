import type { EmbeddingProvider } from "../embedding/provider.js";
import { VectorDB } from "../db/connection.js";
import { searchChunks, searchFiles as searchFilesOp, queryChunksByFilter } from "../db/operations.js";
import type { ChunkRecord, FileRecord } from "../db/schema.js";
import { bm25Score, isIdentifierQuery } from "./bm25.js";
import { escapeLikeValue, escapeSqlString, sanitizeLanguage, sanitizeFilePattern, sanitizeSymbolType } from "../utils/sanitize.js";
import { LANGUAGE_IDS } from "../chunking/languages.js";
import { logger } from "../utils/logger.js";

/** Minimum score to include in results. Filters out noise. */
const MIN_SCORE_THRESHOLD = 0.05;

/** How many extra candidates to fetch for re-ranking */
const RERANK_MULTIPLIER = 3;

export interface CodeSearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  symbolName: string;
  symbolType: string;
  language: string;
  score: number;
}

export interface FileSearchResult {
  filePath: string;
  language: string;
  chunkCount: number;
  symbolCount: number;
  score: number;
}

export interface SymbolSearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string;
  symbolType: string;
  content: string;
  language: string;
  score: number;
}

export class SearchEngine {
  private db: VectorDB;
  private embedder: EmbeddingProvider;

  constructor(db: VectorDB, embedder: EmbeddingProvider) {
    this.db = db;
    this.embedder = embedder;
  }

  async searchCode(
    query: string,
    limit: number,
    language?: string,
    filePattern?: string
  ): Promise<CodeSearchResult[]> {
    const queryVector = await this.embedder.embed(query);
    const table = await this.db.getOrCreateChunksTable();

    const conditions: string[] = [];
    if (language) {
      const safeLang = sanitizeLanguage(language);
      if (!safeLang) {
        // Searching without the filter would return code in every language
        throw new Error(`Unknown language "${language}". Valid values: ${LANGUAGE_IDS.join(", ")}`);
      }
      conditions.push(`language = '${safeLang}'`);
    }
    if (filePattern) {
      conditions.push(`\`filePath\` LIKE '${sanitizeFilePattern(filePattern)}' ESCAPE '\\'`);
    }
    conditions.push(`id != '__placeholder__'`);
    const filter = conditions.join(" AND ");

    // Fetch more candidates than needed for hybrid re-ranking
    const fetchLimit = limit * RERANK_MULTIPLIER;
    const results = await searchChunks(table, queryVector, fetchLimit, filter);

    // Hybrid re-rank: combine vector similarity with BM25 keyword score
    const candidates = results.map((r) => {
      const chunk = r.record as ChunkRecord;
      return {
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        symbolName: chunk.symbolName,
        symbolType: chunk.symbolType,
        language: chunk.language,
        vectorScore: 1 - (r.distance || 0),
        // Searchable text: content + symbol name + file path
        searchText: `${chunk.content} ${chunk.symbolName} ${chunk.filePath}`,
      };
    });

    const ranked = this.hybridRank(query, candidates, limit);

    return ranked.map((c) => ({
      filePath: c.filePath,
      startLine: c.startLine,
      endLine: c.endLine,
      content: c.content,
      symbolName: c.symbolName,
      symbolType: c.symbolType,
      language: c.language,
      score: c.score,
    }));
  }

  async searchFilesByQuery(query: string, limit: number): Promise<FileSearchResult[]> {
    const queryVector = await this.embedder.embed(query);
    const table = await this.db.getOrCreateFilesTable();

    const results = await searchFilesOp(table, queryVector, limit * RERANK_MULTIPLIER);

    const candidates = results
      .filter((r) => (r.record as FileRecord).filePath !== "__placeholder__")
      .map((r) => {
        const file = r.record as FileRecord;
        return {
          filePath: file.filePath,
          language: file.language,
          chunkCount: file.chunkCount,
          symbolCount: file.symbolCount,
          vectorScore: 1 - (r.distance || 0),
          searchText: file.filePath,
        };
      });

    // BM25 on file paths
    const bm25Scores = bm25Score(
      query,
      candidates.map((c) => c.searchText)
    );

    const isIdent = isIdentifierQuery(query);
    const vectorWeight = isIdent ? 0.3 : 0.7;
    const bm25Weight = isIdent ? 0.7 : 0.3;

    // Normalize BM25 scores
    const maxBm25 = Math.max(...bm25Scores, 0.001);

    const scored = candidates.map((c, i) => ({
      ...c,
      score: vectorWeight * c.vectorScore + bm25Weight * (bm25Scores[i] / maxBm25),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score >= MIN_SCORE_THRESHOLD)
      .slice(0, limit)
      .map((c) => ({
        filePath: c.filePath,
        language: c.language,
        chunkCount: c.chunkCount,
        symbolCount: c.symbolCount,
        score: c.score,
      }));
  }

  async searchSymbols(
    query: string,
    limit: number,
    symbolTypes?: string[]
  ): Promise<SymbolSearchResult[]> {
    const table = await this.db.getOrCreateChunksTable();

    // Build shared type filter conditions
    const typeConditions: string[] = [];
    if (symbolTypes && symbolTypes.length > 0) {
      const safeTypes = symbolTypes
        .map((t) => sanitizeSymbolType(t))
        .filter((t): t is string => t !== null);
      if (safeTypes.length > 0) {
        const typeList = safeTypes.map((t) => `'${t}'`).join(", ");
        typeConditions.push(`\`symbolType\` IN (${typeList})`);
      }
    }

    const isIdent = isIdentifierQuery(query);
    const seenIds = new Set<string>();

    type SymbolCandidate = {
      id: string;
      filePath: string;
      startLine: number;
      endLine: number;
      symbolName: string;
      symbolType: string;
      content: string;
      language: string;
      vectorScore: number;
      searchText: string;
      exactBoost: number;
    };

    const allCandidates: SymbolCandidate[] = [];

    // --- Phase 1: Exact and LIKE symbolName matching for identifier queries ---
    if (isIdent) {
      const safeQuery = escapeSqlString(query);
      const likeQuery = escapeLikeValue(query); // _ in snake_case must not match any character

      // Exact match on symbolName
      const exactConditions = [
        `\`symbolName\` = '${safeQuery}'`,
        `id != '__placeholder__'`,
        ...typeConditions,
      ];
      const exactResults = await queryChunksByFilter(
        table,
        exactConditions.join(" AND "),
        limit
      );

      for (const chunk of exactResults) {
        if (!seenIds.has(chunk.id)) {
          seenIds.add(chunk.id);
          allCandidates.push({
            id: chunk.id,
            filePath: chunk.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            symbolName: chunk.symbolName,
            symbolType: chunk.symbolType,
            content: chunk.content,
            language: chunk.language,
            vectorScore: 0.5, // neutral vector score for non-vector results
            searchText: `${chunk.symbolName} ${chunk.symbolType} ${chunk.content}`,
            exactBoost: 0.5, // strong boost for exact match
          });
        }
      }

      // LIKE match on symbolName (contains query as substring)
      const likeConditions = [
        `\`symbolName\` LIKE '%${likeQuery}%' ESCAPE '\\'`,
        `\`symbolName\` != '${safeQuery}'`, // exclude already-found exact matches
        `id != '__placeholder__'`,
        ...typeConditions,
      ];
      const likeResults = await queryChunksByFilter(
        table,
        likeConditions.join(" AND "),
        limit
      );

      for (const chunk of likeResults) {
        if (!seenIds.has(chunk.id)) {
          seenIds.add(chunk.id);
          allCandidates.push({
            id: chunk.id,
            filePath: chunk.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            symbolName: chunk.symbolName,
            symbolType: chunk.symbolType,
            content: chunk.content,
            language: chunk.language,
            vectorScore: 0.5,
            searchText: `${chunk.symbolName} ${chunk.symbolType} ${chunk.content}`,
            exactBoost: 0.25, // moderate boost for partial match
          });
        }
      }

      // Content-based fallback: find identifier in code even when symbolName is empty
      // Catches cases where tree-sitter failed and LineChunker was used
      if (allCandidates.length === 0) {
        const contentConditions = [
          `content LIKE '%${likeQuery}%' ESCAPE '\\'`,
          `id != '__placeholder__'`,
          ...typeConditions,
        ];
        const contentResults = await queryChunksByFilter(
          table,
          contentConditions.join(" AND "),
          limit
        );

        for (const chunk of contentResults) {
          if (!seenIds.has(chunk.id)) {
            seenIds.add(chunk.id);
            allCandidates.push({
              id: chunk.id,
              filePath: chunk.filePath,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              symbolName: chunk.symbolName || query, // use query as fallback name
              symbolType: chunk.symbolType || "unknown",
              content: chunk.content,
              language: chunk.language,
              vectorScore: 0.5,
              searchText: `${query} ${chunk.content}`,
              exactBoost: 0.3, // content match boost
            });
          }
        }
      }
    }

    // --- Phase 2: Vector search (always) ---
    // For identifier queries, also search chunks without symbolName (LineChunker fallback)
    const vectorConditions = [
      ...(isIdent ? [] : [`\`symbolName\` != ''`]),
      `id != '__placeholder__'`,
      ...typeConditions,
    ];
    const vectorFilter = vectorConditions.join(" AND ");
    const fetchLimit = limit * RERANK_MULTIPLIER;

    const queryVector = await this.embedder.embed(query);
    const vectorResults = await searchChunks(table, queryVector, fetchLimit, vectorFilter);

    for (const r of vectorResults) {
      const chunk = r.record as ChunkRecord;
      if (!seenIds.has(chunk.id)) {
        seenIds.add(chunk.id);
        allCandidates.push({
          id: chunk.id,
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          symbolName: chunk.symbolName,
          symbolType: chunk.symbolType,
          content: chunk.content,
          language: chunk.language,
          vectorScore: 1 - (r.distance || 0),
          searchText: `${chunk.symbolName} ${chunk.symbolType} ${chunk.content}`,
          exactBoost: 0,
        });
      }
    }

    // --- Phase 3: Hybrid rank with exact match boost ---
    if (allCandidates.length === 0) return [];

    const bm25Scores = bm25Score(
      query,
      allCandidates.map((c) => c.searchText)
    );

    const maxBm25 = Math.max(...bm25Scores, 0.001);
    const normalizedBm25 = bm25Scores.map((s) => s / maxBm25);

    const vectorWeight = isIdent ? 0.3 : 0.7;
    const bm25Weight = isIdent ? 0.7 : 0.3;

    const scored = allCandidates.map((c, i) => ({
      ...c,
      score: vectorWeight * c.vectorScore + bm25Weight * normalizedBm25[i] + c.exactBoost,
    }));

    logger.debug("Symbol search candidates", {
      isIdentifier: isIdent,
      exactMatches: allCandidates.filter((c) => c.exactBoost === 0.5).length,
      likeMatches: allCandidates.filter((c) => c.exactBoost === 0.25).length,
      vectorMatches: allCandidates.filter((c) => c.exactBoost === 0).length,
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score >= MIN_SCORE_THRESHOLD)
      .slice(0, limit)
      .map((c) => ({
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        symbolName: c.symbolName,
        symbolType: c.symbolType,
        content: c.content,
        language: c.language,
        score: c.score,
      }));
  }

  /**
   * Hybrid ranking: combine vector similarity with BM25 keyword matching.
   * For identifier-like queries (e.g. "authenticateUser"), BM25 is weighted more.
   * For natural language queries, vector similarity is weighted more.
   */
  private hybridRank<T extends { vectorScore: number; searchText: string }>(
    query: string,
    candidates: T[],
    limit: number
  ): (T & { score: number })[] {
    if (candidates.length === 0) return [];

    // Compute BM25 scores
    const bm25Scores = bm25Score(
      query,
      candidates.map((c) => c.searchText)
    );

    // Normalize BM25 to [0, 1]
    const maxBm25 = Math.max(...bm25Scores, 0.001);
    const normalizedBm25 = bm25Scores.map((s) => s / maxBm25);

    // Choose weights based on query type
    const isIdent = isIdentifierQuery(query);
    const vectorWeight = isIdent ? 0.3 : 0.7;
    const bm25Weight = isIdent ? 0.7 : 0.3;

    logger.debug("Hybrid search weights", {
      isIdentifier: isIdent,
      vectorWeight,
      bm25Weight,
      candidates: candidates.length,
    });

    // Combine scores
    const scored = candidates.map((c, i) => ({
      ...c,
      score: vectorWeight * c.vectorScore + bm25Weight * normalizedBm25[i],
    }));

    // Sort by combined score, filter low-quality, take top N
    return scored
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score >= MIN_SCORE_THRESHOLD)
      .slice(0, limit);
  }
}
