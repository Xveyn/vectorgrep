import type { ProjectConfig } from "./schema.js";

/**
 * Arguments given to `init` that take precedence over .vectordb.json. Stored in the index
 * metadata so index_update and reindex keep them; the next init replaces them.
 */
export interface InitOverrides {
  embeddingProvider?: ProjectConfig["embedding"]["provider"];
  embeddingModel?: string;
  includePatterns?: string[];
  excludePatterns?: string[];
}

/** Apply init's arguments to a config loaded from .vectordb.json; mutates and returns it. */
export function applyInitOverrides(config: ProjectConfig, overrides: InitOverrides | undefined): ProjectConfig {
  if (!overrides) return config;
  if (overrides.embeddingProvider) config.embedding.provider = overrides.embeddingProvider;
  if (overrides.embeddingModel) config.embedding.model = overrides.embeddingModel;
  if (overrides.includePatterns) config.files.include = overrides.includePatterns;
  if (overrides.excludePatterns) {
    config.files.exclude = [...config.files.exclude, ...overrides.excludePatterns];
  }
  return config;
}
