import { describe, expect, it } from "vitest"
import { StorageProviderStore } from "../../src/opencode/provider-store.ts"
import { MemoryKv } from "../fakes.ts"

function makeStore() {
  const kv = new MemoryKv()
  return { store: new StorageProviderStore(kv), kv }
}

describe("StorageProviderStore", () => {
  it("saves, gets, and lists records sorted by id", async () => {
    const { store } = makeStore()
    await store.save({ def: { id: "b", name: "B", baseURL: "https://b.dev/v1" }, models: ["m2"] })
    await store.save({ def: { id: "a", name: "A", baseURL: "https://a.dev/v1" }, models: ["m1"] })
    expect((await store.get("b"))?.models).toEqual(["m2"])
    const listed = await store.list()
    expect(listed.map((r) => r.def.id)).toEqual(["a", "b"])
  })

  it("returns undefined for missing ids", async () => {
    const { store } = makeStore()
    expect(await store.get("ghost")).toBeUndefined()
  })

  it("removes records", async () => {
    const { store } = makeStore()
    await store.save({ def: { id: "a", name: "A", baseURL: "https://a.dev/v1" }, models: [] })
    await store.remove("a")
    expect(await store.get("a")).toBeUndefined()
    expect(await store.list()).toEqual([])
  })

  it("drops corrupt entries instead of crashing", async () => {
    const { store, kv } = makeStore()
    await kv.set("custom-provider/bad", "not an object")
    expect(await store.get("bad")).toBeUndefined()
    await kv.set("custom-provider/bad2", { id: 1 })
    await kv.set("custom-provider/bad3", { id: "x", name: "x", baseURL: 3, models: [] })
    await kv.set("custom-provider/bad4", { id: "x", name: "x", baseURL: "u", models: "nope" })
    // Invalid id: dropping (not rewriting) keeps list/get/remove consistent.
    await kv.set("custom-provider/bad5", { id: "Good", name: "G", baseURL: "https://g.dev/v1", models: ["m"] })
    // Invalid baseURL: registering it would produce a broken provider.
    await kv.set("custom-provider/bad6", { id: "x", name: "x", baseURL: "u", models: ["m"] })
    await kv.set("custom-provider/good", { id: "good", name: "G", baseURL: "https://g.dev/v1/", models: ["m", 7] })
    const listed = await store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.def.id).toBe("good")
    expect(listed[0]?.def.baseURL).toBe("https://g.dev/v1")
    expect(listed[0]?.models).toEqual(["m"])
  })

  it("round-trips the health error", async () => {
    const { store } = makeStore()
    await store.save({ def: { id: "acme", name: "Acme", baseURL: "https://a.dev/v1" }, models: ["m1"], lastError: "401" })
    expect((await store.get("acme"))?.lastError).toBe("401")
    await store.save({ def: { id: "acme", name: "Acme", baseURL: "https://a.dev/v1" }, models: ["m1"] })
    expect((await store.get("acme"))?.lastError).toBeUndefined()
  })

  it("scans only its own prefix", async () => {
    const { store, kv } = makeStore()
    await kv.set("decision-cache/x", { n: 1 })
    await store.save({ def: { id: "a", name: "A", baseURL: "https://a.dev/v1" }, models: [] })
    expect((await store.list()).map((r) => r.def.id)).toEqual(["a"])
  })
})