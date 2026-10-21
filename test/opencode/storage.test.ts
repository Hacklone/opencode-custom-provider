import { describe, expect, it } from "vitest"
import { OpencodeStorage } from "../../src/opencode/storage.ts"

interface FakePage {
  entries: { key: string; value: unknown }[]
  next?: string
}

function makeStorage(pages: FakePage[]) {
  const gets = new Map<string, unknown>()
  const calls: { prefix: string; after?: string }[] = []
  let page = 0
  const storage = {
    get: async (key: string) => gets.get(key),
    set: async (key: string, value: unknown) => {
      gets.set(key, value)
    },
    remove: async (key: string) => {
      gets.delete(key)
    },
    scan: async (options: { prefix: string; after?: string }) => {
      calls.push({ prefix: options.prefix, after: options.after })
      const current = pages[page]
      page += 1
      if (current === undefined) return { entries: [] }
      return { entries: current.entries, next: current.next }
    },
  }
  return { storage, calls }
}

describe("OpencodeStorage", () => {
  it("passes get/set/remove through", async () => {
    const { storage } = makeStorage([{ entries: [] }])
    const kv = new OpencodeStorage(storage)
    await kv.set("a", { x: 1 })
    expect(await kv.get("a")).toEqual({ x: 1 })
    await kv.remove("a")
    expect(await kv.get("a")).toBeUndefined()
  })

  it("follows the scan cursor across pages", async () => {
    const { storage, calls } = makeStorage([
      { entries: [{ key: "p/1", value: 1 }], next: "cursor-1" },
      { entries: [{ key: "p/2", value: 2 }], next: "cursor-2" },
      { entries: [{ key: "p/3", value: 3 }] },
    ])
    const kv = new OpencodeStorage(storage)
    expect(await kv.scan("p/")).toEqual([
      { key: "p/1", value: 1 },
      { key: "p/2", value: 2 },
      { key: "p/3", value: 3 },
    ])
    expect(calls.map((c) => c.after)).toEqual([undefined, "cursor-1", "cursor-2"])
  })

  it("filters out entries outside the prefix", async () => {
    const { storage } = makeStorage([
      { entries: [{ key: "other/1", value: 1 }, { key: "p/1", value: 2 }] },
    ])
    const kv = new OpencodeStorage(storage)
    expect(await kv.scan("p/")).toEqual([{ key: "p/1", value: 2 }])
  })

  it("caps runaway cursors at 100 pages", async () => {
    const entry = { key: "p/x", value: 1 }
    const { storage } = makeStorage(Array.from({ length: 150 }, () => ({ entries: [entry], next: "never" })))
    const kv = new OpencodeStorage(storage)
    const result = await kv.scan("p/")
    expect(result).toHaveLength(100)
  })
})