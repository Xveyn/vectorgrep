import type { SearchFilesInput } from "./schemas.js";
import { getProjectContext, NoIndexError } from "../context.js";
import { formatFileResults } from "../search/formatter.js";
import { normalizeProjectPath } from "../utils/paths.js";
import { waitForProjectWrites } from "../utils/project-lock.js";
import { logger } from "../utils/logger.js";

export async function handleSearchFiles(input: SearchFilesInput): Promise<string> {
  const projectPath = normalizeProjectPath(input.projectPath);

  try {
    // A running init/reindex/index_update would otherwise yield empty or stale results
    await waitForProjectWrites(projectPath);
    const ctx = await getProjectContext(projectPath);
    const limit = input.limit || ctx.config.search.defaultLimit;
    const results = await ctx.engine.searchFilesByQuery(input.query, limit);
    return formatFileResults(results);
  } catch (error) {
    if (error instanceof NoIndexError) return error.message;
    logger.error("search_files failed", { error: String(error) });
    return `Error searching files: ${error}`;
  }
}
