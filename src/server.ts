import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  InitInputSchema,
  SearchCodeInputSchema,
  SearchFilesInputSchema,
  SearchSymbolsInputSchema,
  IndexStatusInputSchema,
  ReindexInputSchema,
  IndexUpdateInputSchema,
} from "./tools/schemas.js";
import { handleInit } from "./tools/init.js";
import { handleSearchCode } from "./tools/search-code.js";
import { handleSearchFiles } from "./tools/search-files.js";
import { handleSearchSymbols } from "./tools/search-symbols.js";
import { handleIndexStatus } from "./tools/index-status.js";
import { handleReindex } from "./tools/reindex.js";
import { handleIndexUpdate } from "./tools/index-update.js";
import { logger } from "./utils/logger.js";

// package.json sits one level above both src/ and build/, and ships in the npm package
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

// Agents only see these texts and the tool descriptions — built-in Explore/Plan
// subagents don't even get the project's CLAUDE.md — so they carry the usage rules.
const INSTRUCTIONS = [
  "vectorgrep is a local semantic search index over a codebase.",
  "Workflow: check index_status, run init once per project, then use search_code, search_files and search_symbols; run index_update after code changes.",
  "Use it for questions about what code does or where a concept lives when you don't know the exact names. Use grep for exact text or to find every occurrence of a known identifier.",
  "Every tool takes projectPath, the absolute path of the project root.",
].join("\n");

export function createServer(): McpServer {
  const server = new McpServer({ name: "vectorgrep", version }, { instructions: INSTRUCTIONS });

  server.tool(
    "init",
    "Build the semantic search index for a project. Required once before any search. Scans the project's code files, splits them into symbol-aware chunks, embeds them locally (Ollama, or the built-in transformers.js fallback) and stores them outside the project. Takes seconds to minutes depending on project size. After code changes, use index_update instead of running init again.",
    InitInputSchema.shape,
    async (args) => {
      logger.info("Tool called: init", { projectPath: args.projectPath });
      const result = await handleInit(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "search_code",
    "Find code by describing what it does in natural language, e.g. \"where is the fan speed adjusted based on temperature\". Prefer this over grep when you don't know the exact function or variable names; use grep for exact text. Returns ranked code chunks with file path, line range and symbol. Optional filters: language, filePattern. Requires an index (run init once).",
    SearchCodeInputSchema.shape,
    async (args) => {
      logger.info("Tool called: search_code", { query: args.query });
      const result = await handleSearchCode(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "search_files",
    "Find which files relate to a feature or concept, described in natural language, e.g. \"payment processing\". Returns file paths ranked by relevance, without code — a good first step to orient yourself before reading files. Requires an index (run init once).",
    SearchFilesInputSchema.shape,
    async (args) => {
      logger.info("Tool called: search_files", { query: args.query });
      const result = await handleSearchFiles(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "search_symbols",
    "Find functions, classes, methods, interfaces and types by exact or partial name (e.g. \"TapoService\") or by description. Exact name matches rank first. Returns each definition's location and first lines. Optional filter: symbolTypes. Requires an index (run init once).",
    SearchSymbolsInputSchema.shape,
    async (args) => {
      logger.info("Tool called: search_symbols", { query: args.query });
      const result = await handleSearchSymbols(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "index_status",
    "Show whether a project is indexed and its index statistics: files, chunks and symbols, embedding provider and model, and when it was last indexed. Use it to decide whether init or index_update is needed.",
    IndexStatusInputSchema.shape,
    async (args) => {
      logger.info("Tool called: index_status", { projectPath: args.projectPath });
      const result = await handleIndexStatus(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "reindex",
    "Rebuild the index from scratch. The existing index is replaced only once the new one is complete; if embedding fails, it stays unchanged. Only needed after changing embedding settings or when the index seems broken; for normal code changes use index_update, which is much faster.",
    ReindexInputSchema.shape,
    async (args) => {
      logger.info("Tool called: reindex", { projectPath: args.projectPath });
      const result = await handleReindex(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  server.tool(
    "index_update",
    "Update the index after code changes: re-indexes only files that were added, modified or deleted since the last run. Run it after larger edits or when search results look outdated.",
    IndexUpdateInputSchema.shape,
    async (args) => {
      logger.info("Tool called: index_update", { projectPath: args.projectPath });
      const result = await handleIndexUpdate(args);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  return server;
}
