import { readFile } from "fs/promises";
import { join } from "path";
import { ProjectConfigSchema, type ProjectConfig } from "./schema.js";
import { logger } from "../utils/logger.js";

const CONFIG_FILENAME = ".vectordb.json";

/** Parsed fresh on every call so callers can mutate the result without leaking into other projects */
function defaultConfig(): ProjectConfig {
  return ProjectConfigSchema.parse({});
}

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const configPath = join(projectPath, CONFIG_FILENAME);

  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const config = ProjectConfigSchema.parse(parsed);
    logger.info("Loaded project config", { path: configPath });
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.debug("No .vectordb.json found, using defaults");
      return defaultConfig();
    }
    logger.warn("Failed to parse .vectordb.json, using defaults", {
      error: String(error),
    });
    return defaultConfig();
  }
}
