import { z } from "zod";

export const EmbeddingConfigSchema = z.object({
  provider: z.enum(["auto", "ollama", "transformers", "openai"]).default("auto"),
  // No shared default: each provider falls back to its own model (nomic-embed-text for
  // Ollama, all-MiniLM-L6-v2 for transformers.js, text-embedding-3-small for OpenAI).
  model: z.string().optional(),
  batchSize: z.number().min(1).max(1000).default(100),
  dimensions: z.number().optional(),
  ollamaUrl: z.string().default("http://localhost:11434"),
  openaiApiKey: z.string().optional(),
});

export const FilesConfigSchema = z.object({
  include: z.array(z.string()).default(["**/*"]),
  exclude: z
    .array(z.string())
    .default([
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/vendor/**",
      "**/__pycache__/**",
      "**/target/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.min.js",
      "**/*.min.css",
      "**/package-lock.json",
      "**/yarn.lock",
      "**/pnpm-lock.yaml",
    ]),
  maxFileSize: z.number().default(1_000_000),
  gitOnly: z.boolean().default(true),
});

export const ChunkingConfigSchema = z.object({
  maxChunkLines: z.number().min(10).max(500).default(100),
  overlapLines: z.number().min(0).max(50).default(10),
});

export const SearchConfigSchema = z.object({
  defaultLimit: z.number().min(1).max(100).default(10),
});

export const ProjectConfigSchema = z.object({
  // zod 4: .prefault() parses the given value through the schema (applying each
  // field's own default), whereas .default() now short-circuits and expects the
  // full output object. We want an omitted section to become {} and then be
  // filled in by the inner field defaults.
  embedding: EmbeddingConfigSchema.prefault({}),
  files: FilesConfigSchema.prefault({}),
  chunking: ChunkingConfigSchema.prefault({}),
  search: SearchConfigSchema.prefault({}),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type FilesConfig = z.infer<typeof FilesConfigSchema>;
export type ChunkingConfig = z.infer<typeof ChunkingConfigSchema>;
export type SearchConfig = z.infer<typeof SearchConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
