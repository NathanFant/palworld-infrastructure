import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without this, a compiled dist/ (e.g. from a prior `npm run build`) would also
    // match vitest's default test-file glob, duplicating every test run against
    // both the TS source and its compiled JS output.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  },
});
