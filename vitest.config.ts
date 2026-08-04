import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "packages/app/tests/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/target/**",
    ],
    setupFiles: "packages/app/src/test/setup.ts",
  },
});
