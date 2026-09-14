import type { Chunker, CodeChunk, SymbolType } from "./chunker.js";
import { hashString } from "../utils/hash.js";
import { LineChunker, lineWindows } from "./line-chunker.js";
import { getLanguageForFile } from "./languages.js";
import { logger } from "../utils/logger.js";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// Tree-sitter node types that represent top-level symbols
const SYMBOL_NODE_TYPES: Record<string, SymbolType> = {
  // TypeScript / JavaScript
  function_declaration: "function",
  arrow_function: "function",
  method_definition: "method",
  class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  lexical_declaration: "variable",
  variable_declaration: "variable",
  export_statement: "other",
  import_statement: "import",
  // Python
  function_definition: "function",
  class_definition: "class",
  decorated_definition: "function",
  // Rust
  function_item: "function",
  impl_item: "class",
  struct_item: "type",
  enum_item: "enum",
  trait_item: "interface",
  mod_item: "module",
  // Go
  function_declaration_go: "function",
  method_declaration: "method",
  type_declaration: "type",
  // Java / C#
  method_declaration_java: "method",
  constructor_declaration: "method",
  // General
  program: "other",
};

/** Symbols whose nested declarations (e.g. methods) get their own chunks */
const CONTAINER_TYPES = new Set<SymbolType>(["class", "module"]);

let Parser: any = null;
let parserInstance: any = null;
const loadedLanguages = new Map<string, any>();
let wasmDir: string | null = null;

function findWasmDir(): string {
  // Look for tree-sitter-wasms/out directory
  // Works regardless of where the server is invoked from
  try {
    // `require` doesn't exist in ESM; createRequire resolves from wherever the package is installed
    const wasmPkg = createRequire(import.meta.url).resolve("tree-sitter-wasms/package.json");
    return join(wasmPkg, "..", "out");
  } catch {
    // Fallback: resolve relative to this file's location
    // In ESM, use import.meta.url
    try {
      const thisDir = fileURLToPath(new URL(".", import.meta.url));
      return resolve(thisDir, "../../node_modules/tree-sitter-wasms/out");
    } catch {
      return resolve("node_modules/tree-sitter-wasms/out");
    }
  }
}

async function initTreeSitter(): Promise<boolean> {
  if (Parser) return true;

  try {
    const TreeSitter = await import("web-tree-sitter");
    await TreeSitter.default.init();
    Parser = TreeSitter.default;
    parserInstance = new Parser();
    wasmDir = findWasmDir();
    logger.info("Tree-sitter initialized", { wasmDir });
    return true;
  } catch (error) {
    logger.warn("Failed to initialize tree-sitter, will use line-based chunking", {
      error: String(error),
    });
    return false;
  }
}

async function loadLanguage(grammarName: string): Promise<any | null> {
  if (loadedLanguages.has(grammarName)) {
    return loadedLanguages.get(grammarName);
  }

  if (!wasmDir) {
    loadedLanguages.set(grammarName, null);
    return null;
  }

  const wasmPath = join(wasmDir, `tree-sitter-${grammarName}.wasm`);

  try {
    const lang = await Parser.Language.load(wasmPath);
    loadedLanguages.set(grammarName, lang);
    logger.info(`Loaded tree-sitter grammar: ${grammarName}`);
    return lang;
  } catch (error) {
    logger.debug(`Tree-sitter grammar not available: ${grammarName}`, {
      path: wasmPath,
      error: String(error),
    });
    loadedLanguages.set(grammarName, null);
    return null;
  }
}

export class ASTChunker implements Chunker {
  private lineChunker: LineChunker;
  private maxChunkLines: number;
  private overlapLines: number;

  constructor(maxChunkLines = 100, overlapLines = 10) {
    this.maxChunkLines = maxChunkLines;
    this.overlapLines = overlapLines;
    this.lineChunker = new LineChunker(maxChunkLines, overlapLines);
  }

  async chunk(filePath: string, content: string, language: string): Promise<CodeChunk[]> {
    const langInfo = getLanguageForFile(filePath);
    if (!langInfo?.treeSitterGrammar) {
      return this.lineChunker.chunk(filePath, content, language);
    }

    const tsReady = await initTreeSitter();
    if (!tsReady) {
      return this.lineChunker.chunk(filePath, content, language);
    }

    const lang = await loadLanguage(langInfo.treeSitterGrammar);
    if (!lang) {
      return this.lineChunker.chunk(filePath, content, language);
    }

    try {
      // Reuse the singleton parser instance
      parserInstance.setLanguage(lang);
      const tree = parserInstance.parse(content);

      const chunks = this.extractChunks(tree.rootNode, filePath, content, language);
      tree.delete();

      if (chunks.length === 0) {
        logger.debug("AST produced 0 chunks, falling back to line chunker", {
          file: filePath,
          rootNodeType: tree.rootNode?.type,
          rootChildCount: tree.rootNode?.childCount,
        });
        return this.lineChunker.chunk(filePath, content, language);
      }
      return chunks;
    } catch (error) {
      logger.debug("AST parsing failed, falling back to line chunker", {
        file: filePath,
        error: String(error),
      });
      return this.lineChunker.chunk(filePath, content, language);
    }
  }

  private extractChunks(
    rootNode: any,
    filePath: string,
    fullContent: string,
    language: string
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = fullContent.split("\n");

    this.walkNode(rootNode, filePath, lines, language, chunks, undefined);

    return this.withGapChunks(chunks, filePath, lines, language);
  }

  private walkNode(
    node: any,
    filePath: string,
    lines: string[],
    language: string,
    chunks: CodeChunk[],
    parentName: string | undefined
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      const symbolType = this.getSymbolType(child);
      if (!symbolType || symbolType === "other") {
        // For "other" (exports, imports), still try to extract nested declarations
        if (child.childCount > 0) {
          this.walkNode(child, filePath, lines, language, chunks, parentName);
        }
        continue;
      }

      const startLine = child.startPosition.row + 1;
      const endLine = child.endPosition.row + 1;
      const symbolName = this.getSymbolName(child);

      if (endLine - startLine + 1 <= this.maxChunkLines) {
        chunks.push(this.symbolChunk(filePath, lines, startLine, endLine, symbolName, symbolType, parentName, language));

        // Also recurse for nested symbols (e.g. methods inside class)
        if (child.childCount > 0 && CONTAINER_TYPES.has(symbolType)) {
          this.walkNode(child, filePath, lines, language, chunks, symbolName);
        }
      } else if (CONTAINER_TYPES.has(symbolType)) {
        // Oversized class/module: header chunk for the signature plus nested symbols;
        // whatever they don't cover (fields, etc.) is gap-filled afterwards
        const headerEnd = Math.min(startLine + 5, endLine);
        chunks.push(this.symbolChunk(filePath, lines, startLine, headerEnd, symbolName, symbolType, parentName, language));
        this.walkNode(child, filePath, lines, language, chunks, symbolName);
      } else {
        // Oversized function etc.: split into windows so the whole body stays indexed under the symbol
        for (const [start, end] of lineWindows(startLine, endLine, this.maxChunkLines, this.overlapLines)) {
          chunks.push(this.symbolChunk(filePath, lines, start, end, symbolName, symbolType, parentName, language));
        }
      }
    }
  }

  private getSymbolType(node: any): SymbolType | null {
    if (SYMBOL_NODE_TYPES[node.type]) {
      return SYMBOL_NODE_TYPES[node.type];
    }

    // Handle export statements that wrap declarations
    if (node.type === "export_statement" || node.type === "export_default_declaration") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && SYMBOL_NODE_TYPES[child.type]) {
          return SYMBOL_NODE_TYPES[child.type];
        }
      }
      return "other";
    }

    return null;
  }

  private getSymbolName(node: any): string | undefined {
    // Try direct name field
    const nameNode =
      node.childForFieldName?.("name") ||
      node.childForFieldName?.("declarator");

    if (nameNode) {
      return nameNode.text;
    }

    // For export statements, look into the declaration
    if (node.type === "export_statement" || node.type === "export_default_declaration") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          const childName = child.childForFieldName?.("name");
          if (childName) return childName.text;
        }
      }
    }

    // For decorated definitions (Python @decorator), look at the inner definition
    if (node.type === "decorated_definition") {
      const definition = node.childForFieldName?.("definition");
      if (definition) {
        const defName = definition.childForFieldName?.("name");
        if (defName) return defName.text;
      }
    }

    // For variable/lexical declarations, try first declarator
    if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === "variable_declarator") {
          const varName = child.childForFieldName?.("name");
          if (varName) return varName.text;
        }
      }
    }

    return undefined;
  }

  private symbolChunk(
    filePath: string,
    lines: string[],
    startLine: number,
    endLine: number,
    symbolName: string | undefined,
    symbolType: SymbolType,
    parentName: string | undefined,
    language: string
  ): CodeChunk {
    const content = lines.slice(startLine - 1, endLine).join("\n");
    return {
      // Type and name disambiguate symbols sharing a line range (e.g. a one-line class and its method)
      id: hashString(`${filePath}:${startLine}:${endLine}:${symbolType}:${symbolName ?? ""}`),
      filePath,
      startLine,
      endLine,
      content,
      symbolName,
      symbolType,
      parentSymbol: parentName,
      language,
      summary: this.buildSummary(filePath, symbolName, symbolType, content, language, startLine, endLine),
    };
  }

  /**
   * Line-chunk code that no symbol chunk covers (top-level statements, class fields, ...)
   * so every non-blank line ends up searchable.
   */
  private withGapChunks(
    chunks: CodeChunk[],
    filePath: string,
    lines: string[],
    language: string
  ): CodeChunk[] {
    const covered = new Array<boolean>(lines.length + 1).fill(false);
    for (const chunk of chunks) {
      for (let line = chunk.startLine; line <= chunk.endLine; line++) covered[line] = true;
    }
    const isBlank = (line: number) => lines[line - 1].trim().length === 0;

    const gapChunks: CodeChunk[] = [];
    let line = 1;
    while (line <= lines.length) {
      if (covered[line] || isBlank(line)) {
        line++;
        continue;
      }

      // Extend the gap up to the next covered line, trimming trailing blank lines
      let gapEnd = line;
      for (let next = line + 1; next <= lines.length && !covered[next]; next++) {
        if (!isBlank(next)) gapEnd = next;
      }

      gapChunks.push(...this.lineChunker.chunkLines(filePath, lines, line, gapEnd, language));
      line = gapEnd + 1;
    }

    return [...chunks, ...gapChunks].sort((a, b) => a.startLine - b.startLine);
  }

  private buildSummary(
    filePath: string,
    symbolName: string | undefined,
    symbolType: SymbolType,
    content: string,
    language: string,
    startLine: number,
    endLine: number
  ): string {
    const parts = [`${language} ${symbolType}`];
    if (symbolName) parts.push(`"${symbolName}"`);
    parts.push(`in ${filePath} (lines ${startLine}-${endLine})`);

    const firstLine = content
      .split("\n")
      .find((l) => l.trim().length > 0)
      ?.trim()
      .slice(0, 150);
    if (firstLine) parts.push(`- ${firstLine}`);

    return parts.join(" ");
  }
}
