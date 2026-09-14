import type { EmbeddingProvider } from "./provider.js";
import { withRetry } from "../utils/retry.js";
import { logger } from "../utils/logger.js";

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = "ollama";
  private _dimensions = 0;
  private baseUrl: string;
  readonly model: string;

  constructor(baseUrl = "http://localhost:11434", model = "nomic-embed-text") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async initialize(): Promise<void> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(`Ollama not available at ${this.baseUrl} or model ${this.model} not found`);
    }

    // Get dimensions by embedding a test string
    const testEmbed = await this.embed("test");
    this._dimensions = testEmbed.length;
    logger.info("Ollama provider initialized", {
      model: this.model,
      dimensions: this._dimensions,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return false;
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models || [];
      return models.some(
        (m) => m.name === this.model || m.name === `${this.model}:latest`
      );
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: text }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embed failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { embeddings: number[][] };
      return data.embeddings[0];
    }, "Ollama embed");
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: texts }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embed batch failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { embeddings: number[][] };
      return data.embeddings;
    }, "Ollama embedBatch");
  }
}
