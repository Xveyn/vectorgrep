import type { EmbeddingProvider } from "./provider.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  private _dimensions = 0;
  private apiKey: string;
  readonly model: string;

  constructor(apiKey: string, model = "text-embedding-3-small") {
    this.apiKey = apiKey;
    this.model = model;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async initialize(): Promise<void> {
    const testEmbed = await this.embed("test");
    this._dimensions = testEmbed.length;
    logger.info("OpenAI provider initialized", {
      model: this.model,
      dimensions: this._dimensions,
    });
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async embed(text: string): Promise<number[]> {
    return withRetry(async () => {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: text }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI embed failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return data.data[0].embedding;
    }, "OpenAI embed");
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return withRetry(async () => {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI embed batch failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // Sort by index to maintain order
      return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }, "OpenAI embedBatch");
  }
}
