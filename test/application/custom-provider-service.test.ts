import { describe, expect, it } from "vitest"
import { CustomProviderService } from "../../src/application/custom-provider-service.ts"
import { StorageProviderStore } from "../../src/opencode/provider-store.ts"
import { MemoryKv, FakeCatalog, FakeCredentials, FakeEndpoint, FakeSession } from "../fakes.ts"

function makeService(endpointResult: string[] | Error = ["m1", "m2"]) {
  const store = new StorageProviderStore(new MemoryKv())
  const credentials = new FakeCredentials()
  const endpoint = new FakeEndpoint()
  endpoint.result = endpointResult
  const catalog = new FakeCatalog()
  const session = new FakeSession()
  const service = new CustomProviderService({ store, credentials, endpoint, catalog, session })
  return { service, store, credentials, endpoint, catalog, session }
}

describe("CustomProviderService.add", () => {
  it("derives the id from the name and saves everything", async () => {
    const { service, store, credentials, catalog, endpoint } = makeService()
    const status = await service.add({ name: "Acme LLM", baseURL: "https://api.acme.dev/v1/", key: "sk-1" })
    expect(status).toEqual({
      id: "acme-llm",
      name: "Acme LLM",
      baseURL: "https://api.acme.dev/v1",
      modelCount: 2,
      hasCredential: true,
    })
    expect((await store.get("acme-llm"))?.models).toEqual(["m1", "m2"])
    expect(credentials.saved).toEqual([{ id: "acme-llm", key: "sk-1" }])
    expect(catalog.registered).toHaveLength(1)
    expect(catalog.registered[0]?.seeds).toEqual([
      { id: "m1", name: "m1" },
      { id: "m2", name: "m2" },
    ])
    expect(endpoint.calls[0]?.apiKey).toBe("sk-1")
    // Trailing slash stripped before the fetch.
    expect(endpoint.calls[0]?.baseURL).toBe("https://api.acme.dev/v1")
  })

  it("uses an explicit id when given", async () => {
    const { service } = makeService()
    const status = await service.add({ id: "acme", name: "Acme", baseURL: "https://a.dev/v1" })
    expect(status.id).toBe("acme")
  })

  it("rejects an empty name", async () => {
    const { service, endpoint } = makeService()
    await expect(service.add({ name: "  ", baseURL: "https://a.dev/v1" })).rejects.toThrow(/name must not be empty/)
    await expect(service.add({ name: "Acme", baseURL: "https://a.dev/v1" })).resolves.toBeDefined()
    await expect(service.edit("acme", { name: "" })).rejects.toThrow(/name must not be empty/)
    expect(endpoint.calls).toHaveLength(1)
  })

  it("rejects a duplicate id", async () => {
    const { service } = makeService()
    await service.add({ name: "Acme", baseURL: "https://a.dev/v1" })
    await expect(service.add({ name: "Other", baseURL: "https://b.dev/v1", id: "acme" })).rejects.toThrow(
      /already exists/,
    )
  })

  it("rejects an id that slugs to empty", async () => {
    const { service, endpoint } = makeService()
    await expect(service.add({ name: "!!!", baseURL: "https://a.dev/v1" })).rejects.toThrow(/id derived from/)
    expect(endpoint.calls).toHaveLength(0)
  })

  it("rejects ids over 64 characters", async () => {
    const { service } = makeService()
    await expect(service.add({ name: "x".repeat(70), baseURL: "https://a.dev/v1" })).rejects.toThrow(/exceeds 64/)
  })

  it("rejects reserved built-in ids", async () => {
    const { service } = makeService()
    await expect(service.add({ name: "openai", baseURL: "https://a.dev/v1" })).rejects.toThrow(/reserved/)
  })

  it("validates the base URL before any network call", async () => {
    const { service, endpoint } = makeService()
    await expect(service.add({ name: "Acme", baseURL: "not a url" })).rejects.toThrow(/not a valid http/)
    await expect(service.add({ name: "Acme", baseURL: "ftp://a.dev" })).rejects.toThrow(/not a valid http/)
    expect(endpoint.calls).toHaveLength(0)
  })

  it("rejects a blank key", async () => {
    const { service, endpoint } = makeService()
    await expect(service.add({ name: "Acme", baseURL: "https://a.dev/v1", key: "  " })).rejects.toThrow(
      /key must not be blank/,
    )
    expect(endpoint.calls).toHaveLength(0)
  })

  it("aborts the whole save when the inventory fetch fails (validate-before-save)", async () => {
    const { service, store, credentials, catalog } = makeService(new Error("unreachable"))
    await expect(service.add({ name: "Acme", baseURL: "https://a.dev/v1", key: "sk-1" })).rejects.toThrow(
      "unreachable",
    )
    expect(await store.get("acme")).toBeUndefined()
    expect(credentials.saved).toHaveLength(0)
    expect(catalog.registered).toHaveLength(0)
  })

  it("supports keyless endpoints", async () => {
    const { service, endpoint } = makeService()
    const status = await service.add({ name: "Local", baseURL: "http://127.0.0.1:8000/v1" })
    expect(status.hasCredential).toBe(false)
    expect(endpoint.calls[0]?.apiKey).toBeNull()
  })
})

describe("CustomProviderService.edit", () => {
  async function seed() {
    const ctx = makeService(["m1"])
    await ctx.service.add({ name: "Acme", baseURL: "https://a.dev/v1", key: "sk-1" })
    ctx.endpoint.calls.length = 0
    return ctx
  }

  it("renames without refetching", async () => {
    const { service, endpoint, store } = await seed()
    const status = await service.edit("acme", { name: "Acme Prime" })
    expect(status.name).toBe("Acme Prime")
    expect(status.modelCount).toBe(1)
    expect(endpoint.calls).toHaveLength(0)
    expect((await store.get("acme"))?.def.name).toBe("Acme Prime")
  })

  it("refetches with the stored credential when the baseURL changes", async () => {
    const { service, endpoint, catalog } = await seed()
    endpoint.result = ["m9"]
    const status = await service.edit("acme", { baseURL: "https://b.dev/v1" })
    expect(status.baseURL).toBe("https://b.dev/v1")
    expect(status.modelCount).toBe(1)
    expect(endpoint.calls).toEqual([{ baseURL: "https://b.dev/v1", apiKey: "sk-1" }])
    expect(catalog.registered.at(-1)?.seeds).toEqual([{ id: "m9", name: "m9" }])
  })

  it("does not refetch when the baseURL is unchanged", async () => {
    const { service, endpoint } = await seed()
    await service.edit("acme", { baseURL: "https://a.dev/v1" })
    expect(endpoint.calls).toHaveLength(0)
  })

  it("does not refetch for a cosmetic baseURL change", async () => {
    const { service, endpoint } = await seed()
    const status = await service.edit("acme", { baseURL: "https://a.dev/v1/" })
    expect(status.baseURL).toBe("https://a.dev/v1")
    expect(endpoint.calls).toHaveLength(0)
  })

  it("rotates the key and refetches with the new key", async () => {
    const { service, endpoint, credentials } = await seed()
    endpoint.result = ["m5"]
    const status = await service.edit("acme", { key: "sk-2" })
    expect(endpoint.calls).toEqual([{ baseURL: "https://a.dev/v1", apiKey: "sk-2" }])
    expect(await credentials.resolve("acme")).toBe("sk-2")
    expect(status.modelCount).toBe(1)
  })

  it("rejects a blank key patch", async () => {
    const { service, endpoint, credentials } = await seed()
    await expect(service.edit("acme", { key: " " })).rejects.toThrow(/key must not be blank/)
    expect(endpoint.calls).toHaveLength(0)
    expect(await credentials.resolve("acme")).toBe("sk-1")
  })

  it("keeps the stored inventory when the refetch fails", async () => {
    const { service, endpoint, store, catalog } = await seed()
    endpoint.result = new Error("down")
    await expect(service.edit("acme", { baseURL: "https://b.dev/v1" })).rejects.toThrow("down")
    expect((await store.get("acme"))?.def.baseURL).toBe("https://a.dev/v1")
    expect((await store.get("acme"))?.models).toEqual(["m1"])
    // The failure is recorded as the provider's health.
    expect((await store.get("acme"))?.lastError).toBe("down")
    expect((await service.list())[0]?.lastError).toBe("down")
    // Registration failed before any publish, so no NEW catalog entry was made.
    expect(catalog.registered).toHaveLength(1)
  })

  it("records health on refresh failure and clears it on success", async () => {
    const { service, endpoint, store } = await seed()
    endpoint.result = new Error("401 — bad key")
    await expect(service.refresh("acme")).rejects.toThrow("401")
    expect((await store.get("acme"))?.models).toEqual(["m1"])
    expect((await store.get("acme"))?.lastError).toBe("401 — bad key")

    endpoint.result = ["m1", "m3"]
    expect(await service.refresh("acme")).toEqual(["m1", "m3"])
    expect((await store.get("acme"))?.lastError).toBeUndefined()
    expect((await service.list())[0]?.lastError).toBeUndefined()
  })

  it("rejects an empty patch", async () => {
    const { service } = await seed()
    await expect(service.edit("acme", {})).rejects.toThrow(/edit needs at least one/)
  })

  it("rejects an unknown provider", async () => {
    const { service } = await seed()
    await expect(service.edit("ghost", { name: "X" })).rejects.toThrow(/no custom provider with id/)
  })
})

describe("CustomProviderService.remove", () => {
  it("clears the store, the credential, and the catalog entry", async () => {
    const { service, store, credentials, catalog } = makeService()
    await service.add({ name: "Acme", baseURL: "https://a.dev/v1", key: "sk-1" })
    await service.remove("acme")
    expect(await store.get("acme")).toBeUndefined()
    expect(await credentials.resolve("acme")).toBeNull()
    expect(catalog.unregistered).toEqual(["acme"])
  })

  it("rejects an unknown provider", async () => {
    const { service, catalog } = makeService()
    await expect(service.remove("ghost")).rejects.toThrow(/no custom provider with id/)
    expect(catalog.unregistered).toHaveLength(0)
  })
})

describe("CustomProviderService.refresh", () => {
  it("updates the persisted and registered inventory", async () => {
    const { service, endpoint, store, catalog } = makeService()
    await service.add({ name: "Acme", baseURL: "https://a.dev/v1", key: "sk-1" })
    endpoint.result = ["m1", "m2", "m3"]
    const models = await service.refresh("acme")
    expect(models).toEqual(["m1", "m2", "m3"])
    expect((await store.get("acme"))?.models).toEqual(["m1", "m2", "m3"])
    expect(catalog.registered).toHaveLength(2)
  })

  it("keeps the stored inventory and reports the error on failure", async () => {
    const { service, endpoint, store, catalog } = makeService()
    await service.add({ name: "Acme", baseURL: "https://a.dev/v1", key: "sk-1" })
    endpoint.result = new Error("offline")
    await expect(service.refresh("acme")).rejects.toThrow("offline")
    expect((await store.get("acme"))?.models).toEqual(["m1", "m2"])
    expect(catalog.registered).toHaveLength(1)
  })

  it("rejects an unknown provider", async () => {
    const { service } = makeService()
    await expect(service.refresh("ghost")).rejects.toThrow(/no custom provider with id/)
  })
})

describe("CustomProviderService.list", () => {
  it("reports credential presence and sorts by id", async () => {
    const { service, store } = makeService()
    await service.add({ name: "Zed", baseURL: "https://z.dev/v1", key: "sk-z" })
    await service.add({ name: "Ann", baseURL: "https://a.dev/v1" })
    const statuses = await service.list()
    expect(statuses.map((s) => s.id)).toEqual(["ann", "zed"])
    expect(statuses.map((s) => s.hasCredential)).toEqual([false, true])
    expect((await store.list()).length).toBe(2)
  })

  it("returns an empty list when nothing is registered", async () => {
    const { service } = makeService()
    expect(await service.list()).toEqual([])
  })
})

describe("CustomProviderService selection", () => {
  it("sets the default for a known model", async () => {
    const { service, session } = makeService()
    await service.add({ name: "Acme", baseURL: "https://a.dev/v1" })
    await service.setDefault("acme", "m1")
    expect(session.defaults).toEqual([{ providerID: "acme", modelID: "m1" }])
  })

  it("rejects an unknown model without touching the session", async () => {
    const { service, session } = makeService()
    await service.add({ name: "Acme", baseURL: "https://a.dev/v1" })
    await expect(service.setDefault("acme", "ghost")).rejects.toThrow(/is not in the inventory/)
    expect(session.defaults).toHaveLength(0)
  })

  it("switches the session model for a known model", async () => {
    const { service, session } = makeService()
    await service.add({ name: "Acme", baseURL: "https://a.dev/v1" })
    await service.switchSession("s1", "acme", "m2")
    expect(session.switches).toEqual([{ sessionID: "s1", providerID: "acme", modelID: "m2" }])
  })

  it("rejects an unknown provider for selection", async () => {
    const { service } = makeService()
    await expect(service.switchSession("s1", "ghost", "m1")).rejects.toThrow(/no custom provider with id/)
  })
})

describe("CustomProviderService.restoreAll", () => {
  it("registers stored providers offline with zero endpoint calls", async () => {
    const { service, endpoint, catalog, store } = makeService()
    await store.save({ def: { id: "a", name: "A", baseURL: "https://a.dev/v1" }, models: ["m1"] })
    await store.save({ def: { id: "b", name: "B", baseURL: "https://b.dev/v1" }, models: [] })
    await service.restoreAll()
    expect(endpoint.calls).toHaveLength(0)
    expect(catalog.registered.map((r) => r.def.id).sort()).toEqual(["a", "b"])
  })
})