import { describe, expect, it } from "vitest"
import { OpencodeCatalog } from "../../src/opencode/catalog.ts"
import { FakeCredentials } from "../fakes.ts"

interface PublishedProvider {
  info: Record<string, unknown>
  models: Record<string, unknown>[]
}

interface CatalogEditor {
  get(providerID: string): { provider: { id: string } } | undefined
  add(input: { info: Record<string, unknown>; models: readonly Record<string, unknown>[] }): void
  remove(providerID: string): void
}

function makeCtx() {
  const registry = new Map<string, PublishedProvider>()
  const transforms: ((editor: CatalogEditor) => void)[] = []
  const disposables: string[] = []
  let reloads = 0
  // Simulates a config-defined provider that reappears in every fresh registry.
  let seedConfig: PublishedProvider | undefined
  const editor: CatalogEditor = {
    get: (providerID: string) => {
      const existing = registry.get(providerID)
      return existing === undefined ? undefined : { provider: { id: providerID } }
    },
    add: ({ info, models }: { info: Record<string, unknown>; models: readonly Record<string, unknown>[] }) => {
      registry.set(info["id"] as string, { info, models: [...models] })
    },
    remove: (providerID: string) => {
      registry.delete(providerID)
    },
  }
  const ctx = {
    provider: {
      // Mirrors the real runtime: one stored callback, replayed on every
      // registry rebuild against a fresh registry.
      transform: async (callback: (editor: CatalogEditor) => void) => {
        transforms.push(callback)
        return {
          dispose: () => {
            disposables.push("provider")
          },
        }
      },
      reload: async () => {
        reloads += 1
        registry.clear()
        if (seedConfig !== undefined) registry.set(seedConfig.info["id"] as string, seedConfig)
        for (const callback of transforms) callback(editor)
      },
    },
  }
  return { ctx, registry, disposables, reloads: () => reloads, seed: (s: PublishedProvider | undefined) => { seedConfig = s } }
}

describe("OpencodeCatalog", () => {
  it("registers a provider with the OpenAI-compatible package and fallback limits", async () => {
    const { ctx, registry } = makeCtx()
    const credentials = new FakeCredentials()
    await credentials.save("acme", "sk-1")
    const catalog = new OpencodeCatalog(ctx, credentials)
    await catalog.bootstrap()
    await catalog.register({ id: "acme", name: "Acme", baseURL: "https://a.dev/v1" }, [{ id: "m1", name: "m1" }])
    const published = registry.get("acme")
    expect(published?.info["name"]).toBe("Acme")
    expect(published?.info["activation"]).toBe("enabled")
    expect(published?.info["package"]).toBe("@opencode/ai/providers/openai-compatible")
    expect(published?.info["settings"]).toEqual({ baseURL: "https://a.dev/v1", apiKey: "sk-1" })
    expect(published?.info["integrationID"]).toBe("acme")
    expect(published?.models[0]?.["id"]).toBe("m1")
    expect(published?.models[0]?.["name"]).toBe("m1")
    expect(published?.models[0]?.["limit"]).toEqual({ context: 200_000, output: 32_000 })
    expect(published?.models[0]?.["capabilities"]).toEqual({
      tools: true,
      input: ["text", "image"],
      output: ["text"],
    })
  })

  it("registers keyless providers without apiKey or integrationID", async () => {
    const { ctx, registry } = makeCtx()
    const catalog = new OpencodeCatalog(ctx, new FakeCredentials())
    await catalog.bootstrap()
    await catalog.register({ id: "local", name: "Local", baseURL: "http://127.0.0.1:8000/v1" }, [{ id: "m1", name: "m1" }])
    const published = registry.get("local")
    expect(published?.info["settings"]).toEqual({ baseURL: "http://127.0.0.1:8000/v1" })
    expect(published?.info["integrationID"]).toBeUndefined()
  })

  it("replaces an existing entry on re-registration", async () => {
    const { ctx, registry, seed } = makeCtx()
    const catalog = new OpencodeCatalog(ctx, new FakeCredentials())
    await catalog.bootstrap()
    await catalog.register({ id: "acme", name: "Old", baseURL: "https://old.dev/v1" }, [{ id: "m1", name: "m1" }])
    // Simulate a config-defined provider with the same id: the catalog must
    // remove it before re-adding its own entry.
    seed({ info: { id: "acme", name: "Config Acme" }, models: [] })
    await catalog.register({ id: "acme", name: "New", baseURL: "https://new.dev/v1" }, [{ id: "m2", name: "m2" }])
    const published = registry.get("acme")
    expect(published?.info["name"]).toBe("New")
    expect(published?.models).toHaveLength(1)
    expect(published?.models[0]?.["id"]).toBe("m2")
  })

  it("unregistering drops the entry on the next replay", async () => {
    const { ctx, registry, reloads } = makeCtx()
    const catalog = new OpencodeCatalog(ctx, new FakeCredentials())
    await catalog.bootstrap()
    await catalog.register({ id: "acme", name: "Acme", baseURL: "https://a.dev/v1" }, [{ id: "m1", name: "m1" }])
    await catalog.unregister("acme")
    expect(registry.has("acme")).toBe(false)
    expect(reloads()).toBe(2)
  })

  it("keeps independent entries when publishing several providers", async () => {
    const { ctx, registry } = makeCtx()
    const catalog = new OpencodeCatalog(ctx, new FakeCredentials())
    await catalog.bootstrap()
    await catalog.register({ id: "a", name: "A", baseURL: "https://a.dev/v1" }, [])
    await catalog.register({ id: "b", name: "B", baseURL: "https://b.dev/v1" }, [])
    expect(registry.size).toBe(2)
  })

  it("disposes its transform registration", async () => {
    const { ctx, disposables } = makeCtx()
    const catalog = new OpencodeCatalog(ctx, new FakeCredentials())
    const registration = await catalog.bootstrap()
    registration.dispose()
    expect(disposables).toEqual(["provider"])
  })
})