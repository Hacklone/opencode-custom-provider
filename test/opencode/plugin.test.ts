import { afterEach, describe, expect, it, vi } from "vitest"
import plugin, { PLUGIN_ID } from "../../src/opencode/plugin.ts"
import { lastSynthetic, makeCtx, stubFetch } from "./fake-ctx.ts"

describe("custom-provider plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("exposes the plugin id and registers commands", async () => {
    expect(PLUGIN_ID).toBe("custom-provider")
    const ctx = makeCtx()
    const cleanup = await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    expect(ctx.commands.map((c) => c.name).sort()).toEqual(["custom-provider-connect", "custom-provider-models"])
    expect(typeof cleanup).toBe("function")
  })

  it("restores stored providers offline at setup", async () => {
    stubFetch({ data: [] })
    const fetchCalls = vi.mocked(globalThis.fetch).mock
    const ctx = makeCtx({
      "custom-provider/acme": { id: "acme", name: "Acme", baseURL: "https://a.dev/v1", models: ["m1"] },
    })
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    expect(ctx.providers.get("acme")?.info["name"]).toBe("Acme")
    expect(ctx.providers.get("acme")?.models.map((m) => m["id"])).toEqual(["m1"])
    expect(fetchCalls.calls).toHaveLength(0)
  })

  it("adds a provider through the command", async () => {
    stubFetch({ data: [{ id: "m1" }, { id: "m2" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-provider-connect", "add id=acme name=Acme base=https://a.dev/v1/ key=sk-1")
    expect(ctx.providers.get("acme")?.info["settings"]).toEqual({ baseURL: "https://a.dev/v1", apiKey: "sk-1" })
    expect(ctx.synthetics.at(-1)?.resume).toBe(false)
    expect(lastSynthetic(ctx)).toContain("- acme (Acme) → https://a.dev/v1 · 2 models · credential saved")
  })

  it("reports status through the command", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-provider-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-provider-connect", "")
    expect(lastSynthetic(ctx)).toContain("Custom providers:")
  })

  it("edits and removes through the command", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-provider-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-provider-connect", "edit id=acme name=New")
    expect(ctx.providers.get("acme")?.info["name"]).toBe("New")
    await ctx.run("custom-provider-connect", "edit id=acme key=sk-9")
    expect((ctx.providers.get("acme")?.info["settings"] as Record<string, unknown>)["apiKey"]).toBe("sk-9")
    await ctx.run("custom-provider-connect", "remove id=acme")
    expect(ctx.providers.has("acme")).toBe(false)
    expect(lastSynthetic(ctx)).toContain('Removed custom provider "acme"')
  })

  it("echoes command errors without waking the model", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-provider-connect", "add name=Acme base=not-a-url")
    expect(ctx.synthetics.at(-1)?.resume).toBe(false)
    expect(lastSynthetic(ctx)).toContain("Custom provider error:")
  })

  it("lists models through the custom-models command", async () => {
    stubFetch({ data: [{ id: "m1" }, { id: "m2" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-provider-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-provider-models", "acme")
    expect(lastSynthetic(ctx)).toBe("Models for acme:\n- acme/m1\n- acme/m2")
  })

  it("lists providers when custom-models has no args", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-provider-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-provider-models", "")
    expect(lastSynthetic(ctx)).toContain("Custom providers:")
  })

  it("sets the default and switches the session via custom-models default", async () => {
    stubFetch({ data: [{ id: "m1" }, { id: "m2" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-provider-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-provider-models", "acme default m2")
    expect(ctx.modelDefaults).toEqual([{ providerID: "acme", modelID: "m2" }])
    expect(ctx.switches).toEqual([{ sessionID: "s1", model: { providerID: "acme", id: "m2" } }])
    expect(lastSynthetic(ctx)).toContain("Default model set to acme/m2")
  })

  it("echoes custom-models errors", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-provider-models", "ghost")
    expect(lastSynthetic(ctx)).toContain("Custom model error:")
    expect(lastSynthetic(ctx)).toContain("no custom provider with id")
  })

  it("exposes RPC handlers over the shared service", async () => {
    stubFetch({ data: [{ id: "m1" }, { id: "m2" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    const rpc = ctx.rpc()
    expect(Object.keys(rpc).sort()).toEqual([
      "connect", "edit", "refresh", "remove", "setDefault", "status", "switchSession",
    ])
    const call = async <T>(name: string, input: unknown): Promise<T> => {
      const handler = rpc[name]
      if (handler === undefined) throw new Error(`missing rpc handler ${name}`)
      return (await handler(input as never)) as T
    }
    const status = await call<{ providers: { id: string }[] }>("status", {})
    expect(status.providers).toEqual([])
    const added = await call<{ id: string; modelCount: number }>("connect", {
      name: "Acme",
      baseURL: "https://a.dev/v1",
      key: "sk-1",
    })
    expect(added).toEqual({ id: "acme", name: "Acme", baseURL: "https://a.dev/v1", modelCount: 2, hasCredential: true })
    const edited = await call<{ name: string }>("edit", { id: "acme", name: "New" })
    expect(edited.name).toBe("New")
    const rotated = await call<{ hasCredential: boolean }>("edit", { id: "acme", key: "sk-9" })
    expect(rotated.hasCredential).toBe(true)
    const refreshed = await call<{ models: string[] }>("refresh", { id: "acme" })
    expect(refreshed).toEqual({ id: "acme", models: ["m1", "m2"] })
    await call("setDefault", { providerID: "acme", modelID: "m1" })
    expect(ctx.modelDefaults).toEqual([{ providerID: "acme", modelID: "m1" }])
    await call("switchSession", { sessionID: "s9", providerID: "acme", modelID: "m2" })
    expect(ctx.switches).toEqual([{ sessionID: "s9", model: { providerID: "acme", id: "m2" } }])
    await call("remove", { id: "acme" })
    expect(ctx.providers.has("acme")).toBe(false)
    expect(await call<{ providers: unknown[] }>("status", {})).toEqual({ providers: [] })
  })

  it("disposes registrations on cleanup", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    const cleanup = await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    if (typeof cleanup !== "function") throw new Error("setup returned no cleanup")
    await cleanup()
    expect(ctx.disposables.sort()).toEqual(["command", "model", "provider", "rpc"])
  })
})