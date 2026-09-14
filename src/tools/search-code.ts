import type { SearchCodeInput } from "./schemas.js";
import { getProjectContext, NoIndexError } from "../context.js";
import { formatCodeResults } from "../search/formatter.js";
import { normalizeProjectPath } from "../utils/paths.js";
import { waitForProjectWrites } from "../utils/project-lock.js";
import { logger } from "../utils/logger.js";

export async function handleSearchCode(input: SearchCodeInput): Promise<string> {
  const projectPath = normalizeProjectPath(input.projectPath);

  try {
    // A running init/reindex/index_update would otherwise yield empty or stale results
    await waitForProjectWrites(projectPath);
    const ctx = await getProjectContext(projectPath);
    const limit = input.limit || ctx.config.search.defaultLimit;
    const results = await ctx.engine.searchCode(input.query, limit, input.language, input.filePattern);
    return formatCodeResults(results);
  } catch (error) {
    if (error instanceof NoIndexError) return error.message;
    logger.error("search_code failed", { error: String(error) });
    // Thrown, not returned: the MCP SDK turns it into a result with isError: true
    throw new Error(`Error searching code: ${error}`);
  }
}
