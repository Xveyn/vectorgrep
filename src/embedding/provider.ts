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
