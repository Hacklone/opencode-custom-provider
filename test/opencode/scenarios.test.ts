/**
 * Use-case scenarios: full user journeys through both client surfaces (the
 * RPC handlers the TUI drives and the server commands the web UI drives),
 * asserting observable state — registered providers, credentials, catalog,
 * model selection, and synthetic feedback.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import plugin from "../../src/opencode/plugin.ts"
import { lastSynthetic, makeCtx, rpcCall, stubFetch } from "./fake-ctx.ts"

const setup = async (ctx: ReturnType<typeof makeCtx>, seed: Record<string, unknown> = {}) => {
  const cleanup = await plugin.setup({ ...ctx.ctx, ...seed } as unknown as Parameters<typeof plugin.setup>[0])
  return cleanup
}

describe("custom-provider use cases", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("full lifecycle through RPC (the TUI path)", async () => {
    stubFetch({ data: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] })
    const ctx = makeCtx()
    await setup(ctx)
    const rpc = (name: string, input: unknown) => rpcCall<never>(ctx.rpc(), name, input)

    // Connect (validate-before-save) → provider registered + credential stored.
    const added = (await rpc("connect", { name: "Acme", baseURL: "https://a.dev/v1", key: "sk-1" })) as {
      id: string
      modelCount: number
      hasCredential: boolean
    }
    expect(added).toMatchObject({ id: "acme", modelCount: 3, hasCredential: true })
    expect(ctx.providers.get("acme")?.info["settings"]).toEqual({ baseURL: "https://a.dev/v1", apiKey: "sk-1" })
    expect(ctx.providers.get("acme")?.models.map((m) => m["id"])).toEqual(["m1", "m2", "m3"])

    // Status shows it.
    expect(await rpc("status", {})).toEqual({
      providers: [{ id: "acme", name: "Acme", baseURL: "https://a.dev/v1", modelCount: 3, hasCredential: true }],
    })

    // Name-only edit does not refetch; key rotation refetches with the new key.
    vi.mocked(globalThis.fetch).mockClear()
    const renamed = (await rpc("edit", { id: "acme", name: "Acme 2" })) as { modelCount: number }
    expect(renamed.modelCount).toBe(3)
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(0)
    const edited = (await rpc("edit", { id: "acme", key: "sk-9" })) as { modelCount: number }
    expect(edited.modelCount).toBe(3)
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer sk-9" })
    expect(ctx.providers.get("acme")?.info["name"]).toBe("Acme 2")

    // Refresh refetches the inventory on demand.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "m9" }] }), { status: 200, headers: { "content-type": "application/json" } }),
    )
    expect(await rpc("refresh", { id: "acme" })).toEqual({ id: "acme", models: ["m9"] })
    expect(ctx.providers.get("acme")?.models.map((m) => m["id"])).toEqual(["m9"])

    // Default + session switch.
    await rpc("setDefault", { providerID: "acme", modelID: "m9" })
    expect(ctx.modelDefaults.at(-1)).toEqual({ providerID: "acme", modelID: "m9" })
    await rpc("switchSession", { sessionID: "s1", providerID: "acme", modelID: "m9" })
    expect(ctx.switches.at(-1)?.model).toEqual({ providerID: "acme", id: "m9" })

    // Remove tears the whole registration down.
    await rpc("remove", { id: "acme" })
    expect(ctx.providers.has("acme")).toBe(false)
    expect(await rpc("status", {})).toEqual({ providers: [] })
  })

  it("full lifecycle through server commands (the web UI path)", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await setup(ctx)

    await ctx.run("web-custom-connect", "add id=acme name=Acme base=https://a.dev/v1 key=sk-1")
    await ctx.run("web-custom-models", "acme")
    expect(lastSynthetic(ctx)).toContain("Models for acme:")
    expect(lastSynthetic(ctx)).toContain("- acme/m1")

    await ctx.run("web-custom-models", "acme default m1")
    expect(ctx.modelDefaults.at(-1)).toEqual({ providerID: "acme", modelID: "m1" })
    expect(ctx.switches.at(-1)).toMatchObject({ sessionID: "s1", model: { providerID: "acme", id: "m1" } })

    await ctx.run("web-custom-connect", "remove id=acme")
    expect(lastSynthetic(ctx)).toContain('Removed custom provider "acme"')
    expect(ctx.providers.size).toBe(0)
  })

  it("failed validation leaves nothing behind (connect)", async () => {
    stubFetch({ data: [{ id: "m1" }] }, 401)
    const ctx = makeCtx()
    await setup(ctx)
    await expect(rpcCall(ctx.rpc(), "connect", { name: "Acme", baseURL: "https://a.dev/v1", key: "bad" })).rejects.toThrow(/401/)
    expect(ctx.providers.size).toBe(0)
    expect(await rpcCall(ctx.rpc(), "status", {})).toEqual({ providers: [] })
  })

  it("failed refetch keeps the stored inventory (edit)", async () => {
    stubFetch({ data: [{ id: "m1" }, { id: "m2" }] })
    const ctx = makeCtx()
    await setup(ctx)
    await rpcCall(ctx.rpc(), "connect", { name: "Acme", baseURL: "https://a.dev/v1", key: "sk-1" })
    // The endpoint client binds fetch at construction; queue the failure on
    // the original mock rather than re-stubbing the global.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "content-type": "application/json" } }),
    )
    await expect(rpcCall(ctx.rpc(), "edit", { id: "acme", baseURL: "https://b.dev/v1" })).rejects.toThrow(/500/)
    expect(ctx.providers.get("acme")?.models.map((m) => m["id"])).toEqual(["m1", "m2"])
    expect((ctx.providers.get("acme")?.info["settings"] as Record<string, unknown>)["baseURL"]).toBe("https://a.dev/v1")
    // The failure shows up as the provider's health in status.
    const status = await rpcCall<{ providers: { lastError?: string }[] }>(ctx.rpc(), "status", {})
    expect(status.providers[0]?.lastError).toContain("500")
  })

  it("rejects unknown providers and duplicate ids", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await setup(ctx)
    await rpcCall(ctx.rpc(), "connect", { name: "Acme", baseURL: "https://a.dev/v1" })
    await expect(rpcCall(ctx.rpc(), "connect", { name: "Acme", baseURL: "https://a.dev/v1" })).rejects.toThrow(/acme/)
    await expect(rpcCall(ctx.rpc(), "refresh", { id: "ghost" })).rejects.toThrow(/ghost/)
    await expect(rpcCall(ctx.rpc(), "setDefault", { providerID: "ghost", modelID: "m" })).rejects.toThrow(/ghost/)
    await expect(rpcCall(ctx.rpc(), "remove", { id: "ghost" })).rejects.toThrow(/ghost/)
  })

  it("keyless providers round-trip without a credential", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await setup(ctx)
    const added = (await rpcCall(ctx.rpc(), "connect", { name: "Local", baseURL: "http://127.0.0.1:8000/v1", key: null })) as {
      hasCredential: boolean
    }
    expect(added.hasCredential).toBe(false)
    expect(ctx.providers.get("local")?.info["settings"]).toEqual({ baseURL: "http://127.0.0.1:8000/v1" })
  })

  it("second account is a second provider with its own credential", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await setup(ctx)
    await rpcCall(ctx.rpc(), "connect", { id: "acme-work", name: "Acme Work", baseURL: "https://a.dev/v1", key: "sk-work" })
    await rpcCall(ctx.rpc(), "connect", { id: "acme-home", name: "Acme Home", baseURL: "https://a.dev/v1", key: "sk-home" })
    const status = await rpcCall<{ providers: { id: string }[] }>(ctx.rpc(), "status", {})
    expect(status.providers.map((p) => p.id).sort()).toEqual(["acme-home", "acme-work"])
    expect((ctx.providers.get("acme-work")?.info["settings"] as Record<string, unknown>)["apiKey"]).toBe("sk-work")
    expect((ctx.providers.get("acme-home")?.info["settings"] as Record<string, unknown>)["apiKey"]).toBe("sk-home")
  })

  it("restores every stored provider offline at boot", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx({
      "custom-provider/acme": { id: "acme", name: "Acme", baseURL: "https://a.dev/v1", models: ["m1", "m2"] },
      "custom-provider/local": { id: "local", name: "Local", baseURL: "http://127.0.0.1:8000/v1", models: [] },
    })
    await setup(ctx)
    const fetchCalls = vi.mocked(globalThis.fetch).mock
    expect(fetchCalls.calls).toHaveLength(0)
    expect(ctx.providers.size).toBe(2)
    expect(ctx.providers.get("acme")?.models.map((m) => m["id"])).toEqual(["m1", "m2"])
  })

  it("command errors name the problem without waking the model", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await setup(ctx)
    await ctx.run("web-custom-connect", "add name=Acme base=not-a-url")
    expect(ctx.synthetics.at(-1)?.resume).toBe(false)
    expect(lastSynthetic(ctx)).toContain("not a valid http(s) URL")
    await ctx.run("web-custom-models", "ghost")
    expect(lastSynthetic(ctx)).toContain("ghost")
  })
})