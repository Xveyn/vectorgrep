import type { EmbeddingProvider, HttpProviderOptions } from "./provider.js";
import { withRetry, type RetryOptions } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  private _dimensions = 0;
  private apiKey: string;
  readonly model: string;
  private timeoutMs: number;
  private retry: Partial<RetryOptions>;

  constructor(apiKey: string, model = "text-embedding-3-small", options: HttpProviderOptions = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retry = options.retry ?? {};
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
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`OpenAI embed failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return data.data[0].embedding;
    }, "OpenAI embed", this.retry);
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
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`OpenAI embed batch failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // Sort by index to maintain order
      return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }, "OpenAI embedBatch", this.retry);
  }
}
