import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      // Floor: measured coverage rounded down (CI and local agree). Raise it when
      // tests are added; a drop below fails `npm run test:coverage` in CI.
      thresholds: {
        statements: 81,
        branches: 69,
        functions: 87,
        lines: 82,
      },
    },
  },
});
