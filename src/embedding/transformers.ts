import type { EmbeddingProvider } from "./provider.js";
import { logger } from "../utils/logger.js";

// Dynamic import to avoid loading the heavy library unless needed
let pipeline: any = null;
let extractor: any = null;

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly name = "transformers";
  private _dimensions = 0;
  readonly model: string;

  constructor(model = "Xenova/all-MiniLM-L6-v2") {
    this.model = model;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async initialize(): Promise<void> {
    logger.info("Loading transformers.js model (this may take a moment on first run)...", {
      model: this.model,
    });

    try {
      const transformers = await import("@huggingface/transformers");
      pipeline = transformers.pipeline;
      extractor = await pipeline("feature-extraction", this.model, {
        dtype: "fp32",
      });

      // Get dimensions from test embedding
      const testResult = await extractor("test", { pooling: "mean", normalize: true });
      this._dimensions = testResult.dims[1] || testResult.data.length;
      logger.info("Transformers provider initialized", {
        model: this.model,
        dimensions: this._dimensions,
      });
    } catch (error) {
      throw new Error(`Failed to initialize transformers.js: ${error}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await import("@huggingface/transformers");
      return true;
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!extractor) throw new Error("Transformers provider not initialized");
    const result = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(result.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!extractor) throw new Error("Transformers provider not initialized");
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await this.embed(texts[0])];

    // Process in mini-batches to avoid OOM on large inputs
    const batchSize = 32;
    const allResults: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const result = await extractor(batch, { pooling: "mean", normalize: true });

      // Result tensor shape: [batch_size, dimensions]
      const data = result.data as Float32Array;
      const dims = this._dimensions;

      for (let j = 0; j < batch.length; j++) {
        allResults.push(Array.from(data.slice(j * dims, (j + 1) * dims)));
      }
    }

    return allResults;
  }
}
