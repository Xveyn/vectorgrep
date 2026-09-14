/** Map file extensions to language identifiers and tree-sitter grammar names */

export interface LanguageInfo {
  id: string;
  treeSitterGrammar: string | null;
  extensions: string[];
}

const LANGUAGES: LanguageInfo[] = [
  { id: "typescript", treeSitterGrammar: "typescript", extensions: [".ts", ".mts", ".cts"] },
  { id: "tsx", treeSitterGrammar: "tsx", extensions: [".tsx"] },
  { id: "javascript", treeSitterGrammar: "javascript", extensions: [".js", ".mjs", ".cjs"] },
  { id: "jsx", treeSitterGrammar: "javascript", extensions: [".jsx"] },
  { id: "python", treeSitterGrammar: "python", extensions: [".py", ".pyw"] },
  { id: "rust", treeSitterGrammar: "rust", extensions: [".rs"] },
  { id: "go", treeSitterGrammar: "go", extensions: [".go"] },
  { id: "java", treeSitterGrammar: "java", extensions: [".java"] },
  { id: "c", treeSitterGrammar: "c", extensions: [".c", ".h"] },
  { id: "cpp", treeSitterGrammar: "cpp", extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"] },
  { id: "csharp", treeSitterGrammar: "c_sharp", extensions: [".cs"] },
  { id: "ruby", treeSitterGrammar: "ruby", extensions: [".rb"] },
  { id: "php", treeSitterGrammar: "php", extensions: [".php"] },
  { id: "swift", treeSitterGrammar: "swift", extensions: [".swift"] },
  { id: "kotlin", treeSitterGrammar: "kotlin", extensions: [".kt", ".kts"] },
  { id: "scala", treeSitterGrammar: "scala", extensions: [".scala"] },
  { id: "html", treeSitterGrammar: "html", extensions: [".html", ".htm"] },
  { id: "css", treeSitterGrammar: "css", extensions: [".css"] },
  { id: "scss", treeSitterGrammar: null, extensions: [".scss"] },
  { id: "json", treeSitterGrammar: "json", extensions: [".json"] },
  { id: "yaml", treeSitterGrammar: null, extensions: [".yml", ".yaml"] },
  { id: "toml", treeSitterGrammar: null, extensions: [".toml"] },
  { id: "markdown", treeSitterGrammar: null, extensions: [".md", ".mdx"] },
  { id: "sql", treeSitterGrammar: null, extensions: [".sql"] },
  { id: "shell", treeSitterGrammar: "bash", extensions: [".sh", ".bash", ".zsh"] },
  { id: "dockerfile", treeSitterGrammar: null, extensions: [".dockerfile"] },
  { id: "lua", treeSitterGrammar: "lua", extensions: [".lua"] },
  { id: "zig", treeSitterGrammar: null, extensions: [".zig"] },
  { id: "elixir", treeSitterGrammar: null, extensions: [".ex", ".exs"] },
  { id: "haskell", treeSitterGrammar: null, extensions: [".hs"] },
];

const extensionMap = new Map<string, LanguageInfo>();
for (const lang of LANGUAGES) {
  for (const ext of lang.extensions) {
    extensionMap.set(ext, lang);
  }
}

// Special filenames
const filenameMap = new Map<string, LanguageInfo>([
  ["Dockerfile", LANGUAGES.find((l) => l.id === "dockerfile")!],
  ["Makefile", { id: "makefile", treeSitterGrammar: null, extensions: [] }],
]);

/** Every language id the indexer can assign, i.e. every value a language filter can match. */
export const LANGUAGE_IDS: readonly string[] = [
  ...new Set([...LANGUAGES, ...filenameMap.values()].map((l) => l.id)),
];

export function getLanguageForFile(filePath: string): LanguageInfo | null {
  const fileName = filePath.split("/").pop() || filePath;

  // Check special filenames
  const byName = filenameMap.get(fileName);
  if (byName) return byName;

  // Check extension
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const ext = fileName.slice(dotIndex).toLowerCase();
  return extensionMap.get(ext) || null;
}

export function isSupportedFile(filePath: string): boolean {
  return getLanguageForFile(filePath) !== null;
}
