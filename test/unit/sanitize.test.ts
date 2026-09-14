import { describe, it, expect } from "vitest";
import {
  escapeLikeValue,
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

  it("keeps backslashes, since DataFusion string literals have no backslash escapes (#36)", () => {
    expect(escapeSqlString("odd\\name.ts")).toBe("odd\\name.ts");
  });
});

describe("escapeLikeValue", () => {
  it("escapes LIKE wildcards so they match literally (#36)", () => {
    expect(escapeLikeValue("get_user")).toBe("get\\_user");
    expect(escapeLikeValue("100%")).toBe("100\\%");
  });

  it("escapes the escape character itself and doubles quotes", () => {
    expect(escapeLikeValue("a\\b")).toBe("a\\\\b");
    expect(escapeLikeValue("it's")).toBe("it''s");
  });
});

describe("sanitizeLanguage", () => {
  it("normalizes known language ids", () => {
    expect(sanitizeLanguage("  TypeScript ")).toBe("typescript");
    expect(sanitizeLanguage("cpp")).toBe("cpp");
    expect(sanitizeLanguage("csharp")).toBe("csharp");
  });

  it("rejects ids the indexer never assigns (#36)", () => {
    expect(sanitizeLanguage("c++")).toBeNull();
    expect(sanitizeLanguage("golang")).toBeNull();
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
    expect(sanitizeFilePattern("src/%' OR '1'='1")).toBe("src/\\%'' OR ''1''=''1");
    expect(sanitizeFilePattern("src/\0a\x07b")).toBe("src/ab");
  });

  it("escapes LIKE wildcards _ and % from the input (#36)", () => {
    expect(sanitizeFilePattern("src/my_file%.ts")).toBe("src/my\\_file\\%.ts");
  });

  it("lets ** match any directory depth, including none (#36)", () => {
    expect(sanitizeFilePattern("src/**/*.ts")).toBe("src/%.ts");
    expect(sanitizeFilePattern("**/*.ts")).toBe("%.ts");
    expect(sanitizeFilePattern("src/**")).toBe("src/%");
  });

  it("turns glob ? into a single-character wildcard (#36)", () => {
    expect(sanitizeFilePattern("src/?.ts")).toBe("src/_.ts");
  });
});
