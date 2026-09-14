import type { EmbeddingProvider } from "./embedding/provider.js";
import { createEmbeddingProvider } from "./embedding/factory.js";
import { VectorDB } from "./db/connection.js";
import { SearchEngine } from "./search/engine.js";
import { loadProjectConfig } from "./config/loader.js";
import type { ProjectConfig } from "./config/schema.js";
import { normalizeProjectPath } from "./utils/paths.js";
import { logger } from "./utils/logger.js";

interface ProjectContext {
  projectPath: string;
  config: ProjectConfig;
  embedder: EmbeddingProvider;
  db: VectorDB;
  engine: SearchEngine;
  lastAccessed: number;
}

/** Thrown when searching a project that has never been indexed. */
export class NoIndexError extends Error {
  constructor(projectPath: string) {
    super(`No index found for: ${projectPath}\nRun 'init' to create the vector index.`);
    this.name = "NoIndexError";
  }
}

const projectContexts = new Map<string, ProjectContext>();
const pendingInits = new Map<string, Promise<ProjectContext>>();

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get or create a cached context (embedder + DB + engine) for a project.
 * Avoids re-initializing the embedding provider on every tool call.
 * Uses a pending-promise lock to prevent duplicate concurrent initialization.
 */
export async function getProjectContext(projectPath: string): Promise<ProjectContext> {
  const normalized = normalizeProjectPath(projectPath);

  // Return cached context if available
  const existing = projectContexts.get(normalized);
  if (existing) {
    existing.lastAccessed = Date.now();
    return existing;
  }

  // If another call is already initializing this project, wait for it
  const pending = pendingInits.get(normalized);
  if (pending) {
    return pending;
  }

  // Start initialization and store the promise to prevent duplicates
  const initPromise = initProjectContext(normalized);
  pendingInits.set(normalized, initPromise);

  try {
    const ctx = await initPromise;
    return ctx;
  } finally {
    pendingInits.delete(normalized);
  }
}

async function initProjectContext(normalized: string): Promise<ProjectContext> {
  logger.info("Creating new project context", { projectPath: normalized });

  // loadMetadata only reads metadata.json, so no connection (which would create
  // the database directory) is needed to find out whether an index exists
  const metadata = await new VectorDB(normalized, 0).loadMetadata();
  if (!metadata) {
    // Opening tables here would create empty placeholder tables for a project that was never indexed
    throw new NoIndexError(normalized);
  }

  const config = await loadProjectConfig(normalized);
  config.embedding.provider = metadata.embeddingProvider as any;
  config.embedding.model = metadata.embeddingModel;

  const embedder = await createEmbeddingProvider(config.embedding);

  // Reconnect with correct dimensions
  const dbWithDims = new VectorDB(normalized, embedder.dimensions);
  await dbWithDims.connect();

  const engine = new SearchEngine(dbWithDims, embedder);

  const ctx: ProjectContext = {
    projectPath: normalized,
    config,
    embedder,
    db: dbWithDims,
    engine,
    lastAccessed: Date.now(),
  };

  projectContexts.set(normalized, ctx);
  scheduleCleanup();

  return ctx;
}

/**
 * Invalidate a project's cached context (e.g. after reindex with different provider).
 */
export async function invalidateProjectContext(projectPath: string): Promise<void> {
  const normalized = normalizeProjectPath(projectPath);
  const existing = projectContexts.get(normalized);
  if (existing) {
    await existing.db.close();
    projectContexts.delete(normalized);
    logger.info("Project context invalidated", { projectPath: normalized });
  }
}

/**
 * Check if a project has an index (without creating full context).
 */
export async function hasProjectIndex(projectPath: string): Promise<boolean> {
  const normalized = normalizeProjectPath(projectPath);
  const db = new VectorDB(normalized, 0);
  await db.connect();
  const metadata = await db.loadMetadata();
  await db.close();
  return metadata !== null;
}

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setTimeout(async () => {
    cleanupTimer = null;
    const now = Date.now();
    for (const [key, ctx] of projectContexts) {
      if (now - ctx.lastAccessed > CACHE_TTL_MS) {
        await ctx.db.close();
        projectContexts.delete(key);
        logger.info("Cleaned up stale project context", { projectPath: key });
      }
    }
    if (projectContexts.size > 0) {
      scheduleCleanup();
    }
  }, CACHE_TTL_MS);
}
