/**
 * Sanitize user input for use in LanceDB SQL-like WHERE clauses.
 * LanceDB uses DataFusion SQL syntax — no parameterized queries available,
 * so we must escape values before interpolation.
 */

import { LANGUAGE_IDS } from "../chunking/languages.js";

/**
 * Escape a string value for safe use inside single-quoted SQL literals.
 * Handles single quotes, null bytes and other control characters. Backslashes stay as
 * they are: DataFusion string literals have no backslash escapes.
 */
export function escapeSqlString(value: string): string {
  return value
    .replace(/'/g, "''")      // single quotes (SQL standard doubling)
    .replace(/\0/g, "")       // strip null bytes
    .replace(/[\x01-\x1f]/g, ""); // strip other control characters
}

/**
 * Escape a value for a LIKE pattern that must match it literally, e.g. `'%${value}%'`.
 * Use the result with `ESCAPE '\'`.
 */
export function escapeLikeValue(value: string): string {
  return escapeSqlString(value).replace(/[\\%_]/g, "\\$&");
}

/**
 * Validate and normalize a language filter value.
 * Only ids the indexer actually assigns are accepted (e.g. "cpp", not "c++").
 */
export function sanitizeLanguage(lang: string): string | null {
  const cleaned = lang.trim().toLowerCase();
  return LANGUAGE_IDS.includes(cleaned) ? cleaned : null;
}

/**
 * Validate and sanitize symbol type values.
 * Only allows known symbol type identifiers.
 */
export function sanitizeSymbolType(type: string): string | null {
  const cleaned = type.trim().toLowerCase();
  if (/^[a-z_]+$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

/**
 * Translate a file glob into a LIKE pattern; use the result with `ESCAPE '\'`.
 * `*` matches any characters including `/`; `**`, also when followed by a slash, matches any
 * directory depth including none; `?` matches one character. `%` and `_` in the input match literally.
 */
export function sanitizeFilePattern(pattern: string): string {
  return pattern
    .replace(/\\/g, "/")       // normalize path separators
    .replace(/\0/g, "")        // strip null bytes
    .replace(/[\x01-\x1f]/g, "") // strip control chars
    .replace(/[%_]/g, "\\$&")  // LIKE wildcards in the input match literally
    .replace(/'/g, "''")       // escape quotes
    .replace(/(?:\*\*\/)+\*?|\*+/g, "%") // glob * / ** / **/ -> SQL %
    .replace(/\?/g, "_");      // glob ? -> SQL _
}
