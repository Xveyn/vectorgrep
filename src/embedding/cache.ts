import type { EmbeddingProvider } from "./provider.js";
import { logger } from "../utils/logger.js";

interface CacheEntry {
  vector: number[];
  accessedAt: number;
}

/**
 * LRU cache wrapper around an EmbeddingProvider.
 * Caches query embeddings to avoid re-computing identical queries.
 */
export class CachedEmbeddingProvider implements EmbeddingProvider {
  private inner: EmbeddingProvider;
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(inner: EmbeddingProvider, maxSize = 500) {
    this.inner = inner;
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get name(): string {
    return this.inner.name;
  }

  get model(): string {
    return this.inner.model;
  }

  get dimensions(): number {
    return this.inner.dimensions;
  }

  async initialize(): Promise<void> {
    return this.inner.initialize();
  }

  async isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) {
      this.hits++;
      cached.accessedAt = Date.now();
      return cached.vector;
    }

    this.misses++;
    const vector = await this.inner.embed(text);

    // Evict oldest if full
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(text, { vector, accessedAt: Date.now() });
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Check cache first
    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i]);
      if (cached) {
        this.hits++;
        cached.accessedAt = Date.now();
        results[i] = cached.vector;
      } else {
        this.misses++;
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    // Embed only uncached texts
    if (uncachedTexts.length > 0) {
      const newVectors = await this.inner.embedBatch(uncachedTexts);

      for (let j = 0; j < uncachedIndices.length; j++) {
        const idx = uncachedIndices[j];
        results[idx] = newVectors[j];

        // Evict if needed
        if (this.cache.size >= this.maxSize) {
          this.evictOldest();
        }
        this.cache.set(texts[idx], { vector: newVectors[j], accessedAt: Date.now() });
      }
    }

    return results;
  }

  getStats(): { hits: number; misses: number; size: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : "N/A",
    };
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
