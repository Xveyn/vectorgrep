#!/usr/bin/env node
/**
 * Builds the GitHub release notes for the current version from CHANGELOG.md.
 *
 *   node scripts/release-notes.mjs --check          # fail if the section is missing or empty (CI)
 *   node scripts/release-notes.mjs --out notes.md   # write the release body
 *
 * The version comes from package.json. The body is the `## X.Y.Z — date` section
 * without its heading: the release title already names the version and GitHub
 * shows the date. An empty section counts as missing — a release with an empty
 * body looks like a failure to the reader.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Returns the section for `version` without its heading, or null if missing or empty. */
export function releaseBody(changelog, version) {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The lookahead keeps "0.2.1" from matching "## 0.2.10"
  const heading = new RegExp(`^##\\s+${escaped}(?![\\w.-])`);

  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;

  const next = lines.findIndex((line, i) => i > start && /^##\s/.test(line));
  const end = next === -1 ? lines.length : next;
  const body = lines.slice(start + 1, end).join("\n").trim();
  return body || null;
}

function main(args) {
  const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const body = releaseBody(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"), version);

  if (body === null) {
    // ::error:: turns the line into an annotation on the Actions job
    console.log(
      `::error::CHANGELOG.md has no (or an empty) section '## ${version}'. ` +
        "The release notes are built from it — add it in the release PR (see RELEASING.md)."
    );
    return 1;
  }

  const lineCount = body.split("\n").length;
  if (args.includes("--check")) {
    console.log(`CHANGELOG.md: section for ${version} found (${lineCount} lines).`);
    return 0;
  }

  const outIndex = args.indexOf("--out");
  if (outIndex !== -1) {
    const target = args[outIndex + 1];
    if (!target) {
      console.log("::error::--out needs a file name.");
      return 2;
    }
    writeFileSync(target, `${body}\n`);
    console.log(`${target}: release notes for ${version} written (${lineCount} lines).`);
    return 0;
  }

  process.stdout.write(`${body}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
