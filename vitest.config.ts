import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The TUI entry is JSX rendered by OpenCode's OpenTUI runtime; it is
      // exercised manually against a live TUI, not under vitest.
      // src/index.ts is the npm/local entry shim (executed by the loader).
      // src/ports/** are type-only contracts (no runtime statements).
      exclude: ["src/tui.tsx", "src/index.ts", "src/ports/**"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
})