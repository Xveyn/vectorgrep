import type { EmbeddingProvider } from "../../src/embedding/provider.js";
import { createHash } from "crypto";

/**
 * Deterministic mock embedding provider for testing.
 * Generates consistent vectors based on input text hash.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly model = "mock-model";
  readonly dimensions: number;

  constructor(dimensions = 64) {
    this.dimensions = dimensions;
  }

  async initialize(): Promise<void> {
    // No-op
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async embed(text: string): Promise<number[]> {
    return this.deterministicVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.deterministicVector(t));
  }

  private deterministicVector(text: string): number[] {
    const hash = createHash("sha256").update(text).digest();
    const vector: number[] = [];

    for (let i = 0; i < this.dimensions; i++) {
      // Use hash bytes cyclically to generate float values between -1 and 1
      const byteIndex = i % hash.length;
      vector.push((hash[byteIndex] / 128.0) - 1.0);
    }

    // Normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => v / norm);
  }
}
