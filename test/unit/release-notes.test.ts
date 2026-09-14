import { describe, it, expect } from "vitest";
// @ts-expect-error -- plain ESM script without type declarations
import { releaseBody } from "../../scripts/release-notes.mjs";

const CHANGELOG = `# Changelog

## 0.2.10 — 2026-10-01

### Fixed
- Newest fix.

## 0.2.1 — 2026-09-20

A short intro.

### Added
- **Feature**: does something.

## 0.2.0 — 2026-09-14

## 0.1.0 - 2026-03

### Added
- Initial release.
`;

describe("releaseBody", () => {
  it("returns the version's section without its heading", () => {
    expect(releaseBody(CHANGELOG, "0.2.1")).toBe(
      "A short intro.\n\n### Added\n- **Feature**: does something."
    );
  });

  it("stops at the next version heading", () => {
    expect(releaseBody(CHANGELOG, "0.2.10")).toBe("### Fixed\n- Newest fix.");
  });

  it("does not match a version that only shares a prefix", () => {
    expect(releaseBody(CHANGELOG, "0.2")).toBeNull();
    expect(releaseBody("## 0.2.10 — 2026-10-01\n\n- x\n", "0.2.1")).toBeNull();
  });

  it("returns null for a missing version", () => {
    expect(releaseBody(CHANGELOG, "9.9.9")).toBeNull();
  });

  it("returns null for an empty section", () => {
    expect(releaseBody(CHANGELOG, "0.2.0")).toBeNull();
  });

  it("accepts headings without a date and the last section in the file", () => {
    expect(releaseBody("## 1.0.0\n\n- Done.", "1.0.0")).toBe("- Done.");
    expect(releaseBody(CHANGELOG, "0.1.0")).toBe("### Added\n- Initial release.");
  });
});
