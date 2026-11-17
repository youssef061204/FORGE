import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
    // Concurrent TypeScript compilers and isolated workers otherwise compete
    // with the broker's real per-node deadlines on development machines.
    maxWorkers: 2,
  },
});
