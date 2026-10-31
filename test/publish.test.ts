/**
 * Regression test for the 0.1.6 published-tarball breakage: src/tui.tsx and
 * src/opencode/plugin.ts imported "../rpc.ts" — the repo-ROOT shim that only
 * exists for local discovery, never shipped (files: ["src", "tsconfig.json"]).
 * Tests and both e2e harnesses run against the local checkout where the root
 * shims resolve, so only a real npm install exploded ("Cannot find module
 * '../rpc.ts'" from the npm cache dir). This test packs the tarball exactly
 * as npm would and asserts the shipped module graph is closed over the
 * shipped file set.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const ROOT = resolve(fileURLToPath(import.meta.url), "../..")

interface PackedFile {
  path: string
}

function shippedFiles(): Set<string> {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  })
  const packed = JSON.parse(out) as { files: PackedFile[] }[]
  // npm pack --json always emits exactly one entry for the packed package.
  return new Set(packed[0]!.files.map((f) => f.path))
}

/** Every relative specifier string-literal in a source file (from/import/export/dynamic). */
function relativeImports(source: string): string[] {
  const specs: string[] = []
  for (const match of source.matchAll(/["'](\.[^"']+)["']/g)) {
    // The capture group always participates when the regex matches.
    const spec = match[1]!
    if (spec.startsWith("./") || spec.startsWith("../")) specs.push(spec)
  }
  return specs
}

/** Candidate files a specifier may resolve to (exact or extension/index-appended), package-relative. */
function candidates(spec: string, importer: string): string[] {
  const base = resolve(dirname(resolve(ROOT, importer)), spec)
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ].map((c) => relative(ROOT, c))
}

it("every relative import in the published tarball resolves to a shipped file", () => {
  const shipped = shippedFiles()
  expect(shipped.size).toBeGreaterThan(0)

  const broken: string[] = []
  for (const file of shipped) {
    if (!/\.(ts|tsx)$/.test(file)) continue
    for (const spec of relativeImports(readFileSync(resolve(ROOT, file), "utf8"))) {
      if (!candidates(spec, file).some((c) => shipped.has(c))) {
        broken.push(`${file} imports "${spec}" — not shipped`)
      }
    }
  }
  expect(broken, "published module graph must be closed").toEqual([])
})

it("the package exports map points at shipped files", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    exports: Record<string, string>
  }
  const shipped = shippedFiles()
  const missing = Object.entries(pkg.exports)
    .filter(([, target]) => !shipped.has(target.replace(/^\.\//, "")))
    .map(([key, target]) => `${key} -> ${target}`)
  expect(missing, "exports targets must all be shipped").toEqual([])
})
