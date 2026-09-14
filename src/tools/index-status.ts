import type { IndexStatusInput } from "./schemas.js";
import { VectorDB } from "../db/connection.js";
import { normalizeProjectPath } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

export async function handleIndexStatus(input: IndexStatusInput): Promise<string> {
  const projectPath = normalizeProjectPath(input.projectPath);

  try {
    const db = new VectorDB(projectPath, 0);
    await db.connect();

    const metadata = await db.loadMetadata();
    if (!metadata) {
      await db.close();
      return `No index found for: ${projectPath}\nRun 'init' to create the vector index.`;
    }

    await db.close();

    const lastIndexed = new Date(metadata.lastIndexedAt);
    const created = new Date(metadata.createdAt);
    const ageMs = Date.now() - lastIndexed.getTime();
    const ageMinutes = Math.floor(ageMs / 60000);
    const ageStr =
      ageMinutes < 60
        ? `${ageMinutes}m ago`
        : ageMinutes < 1440
          ? `${Math.floor(ageMinutes / 60)}h ago`
          : `${Math.floor(ageMinutes / 1440)}d ago`;

    return [
      `Index Status for: ${metadata.projectPath}`,
      ``,
      `Files indexed:    ${metadata.totalFiles}`,
      `Chunks stored:    ${metadata.totalChunks}`,
      `Symbols found:    ${metadata.totalSymbols}`,
      ``,
      `Embedding:        ${metadata.embeddingProvider} / ${metadata.embeddingModel}`,
      `Dimensions:       ${metadata.dimensions}`,
      `Version:          ${metadata.version}`,
      ``,
      `Created:          ${created.toLocaleString()}`,
      `Last indexed:     ${lastIndexed.toLocaleString()} (${ageStr})`,
    ].join("\n");
  } catch (error) {
    logger.error("index_status failed", { error: String(error) });
    // Thrown, not returned: the MCP SDK turns it into a result with isError: true
    throw new Error(`Error getting index status: ${error}`);
  }
}
