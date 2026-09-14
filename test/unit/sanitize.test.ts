import { describe, it, expect } from "vitest";
import {
  escapeSqlString,
  sanitizeFilePattern,
  sanitizeLanguage,
  sanitizeSymbolType,
} from "../../src/utils/sanitize.js";

describe("escapeSqlString", () => {
  it("doubles single quotes so a value can't close its literal", () => {
    expect(escapeSqlString("x' OR '1'='1")).toBe("x'' OR ''1''=''1");
  });

  it("strips null bytes and other control characters", () => {
    expect(escapeSqlString("a\0b\x01c\nd\x1fe")).toBe("abcde");
  });

  it("leaves ordinary paths and identifiers unchanged", () => {
    expect(escapeSqlString("src/utils/sanitize.ts")).toBe("src/utils/sanitize.ts");
    expect(escapeSqlString("authenticateUser")).toBe("authenticateUser");
  });
});

describe("sanitizeLanguage", () => {
  it("normalizes valid language ids", () => {
    expect(sanitizeLanguage("  TypeScript ")).toBe("typescript");
    expect(sanitizeLanguage("c++")).toBe("c++");
    expect(sanitizeLanguage("c#")).toBe("c#");
    expect(sanitizeLanguage("objective-c")).toBe("objective-c");
  });

  it("rejects anything that could change the filter", () => {
    expect(sanitizeLanguage("typescript' OR '1'='1")).toBeNull();
    expect(sanitizeLanguage("ts; DROP TABLE chunks")).toBeNull();
    expect(sanitizeLanguage("")).toBeNull();
  });
});

describe("sanitizeSymbolType", () => {
  it("accepts lowercase identifiers", () => {
    expect(sanitizeSymbolType(" Function ")).toBe("function");
    expect(sanitizeSymbolType("type_alias")).toBe("type_alias");
  });

  it("rejects quotes, operators and digits", () => {
    expect(sanitizeSymbolType("class') OR ('1'='1")).toBeNull();
    expect(sanitizeSymbolType("class1")).toBeNull();
  });
});

describe("sanitizeFilePattern", () => {
  it("turns glob stars into LIKE wildcards", () => {
    expect(sanitizeFilePattern("src/*.ts")).toBe("src/%.ts");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(sanitizeFilePattern("src\\tools\\*")).toBe("src/tools/%");
  });

  it("doubles quotes and strips control characters", () => {
    expect(sanitizeFilePattern("src/%' OR '1'='1")).toBe("src/%'' OR ''1''=''1");
    expect(sanitizeFilePattern("src/\0a\x07b")).toBe("src/ab");
  });

  it.todo("escapes LIKE wildcards _ and % from the input (#36)");
});
