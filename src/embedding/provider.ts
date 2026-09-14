import type { RetryOptions } from "../utils/retry.js";

/** Options for providers that call an HTTP API. */
export interface HttpProviderOptions {
  /** Abort a request that takes longer than this. */
  timeoutMs?: number;
  /** Overrides for the retry policy of embedding requests. */
  retry?: Partial<RetryOptions>;
}

export interface EmbeddingProvider {
  readonly name: string;
  /** Model actually in use (the provider's default when none was configured) */
  readonly model: string;
  readonly dimensions: number;

  /** Initialize the provider (load model, check availability) */
  initialize(): Promise<void>;

  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;

  /** Generate embeddings for a batch of texts */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Check if this provider is available */
  isAvailable(): Promise<boolean>;
}
