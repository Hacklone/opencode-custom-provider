import { afterEach, describe, expect, it, vi } from "vitest"
import plugin, { PLUGIN_ID } from "../../src/opencode/plugin.ts"
import { MemoryKv } from "../fakes.ts"

interface RegisteredCommand {
  name: string
  execute(input: { sessionID: string; prompt: { text: string } }): Promise<void>
}

function makeCtx(seed: Record<string, unknown> = {}) {
  const kv = new MemoryKv()
  for (const [key, value] of Object.entries(seed)) void kv.set(key, value)

  const providers = new Map<string, { info: Record<string, unknown>; models: Record<string, unknown>[] }>()
  const providerTransforms: ((editor: never) => void)[] = []
  const providerReloads: number[] = []
  const modelTransforms: ((editor: { default: { set(providerID: string, modelID: string): void } }) => void)[] = []
  const modelDefaults: { providerID: string; modelID: string }[] = []
  const synthetics: { sessionID: string; text: string; resume: boolean }[] = []
  const switches: { sessionID: string; model: { providerID: string; id: string } }[] = []
  const commands: RegisteredCommand[] = []
  const disposables: string[] = []

  const providerEditor = {
    get: (providerID: string) =>
      providers.has(providerID) ? { provider: { id: providerID } } : undefined,
    add: ({ info, models }: { info: Record<string, unknown>; models: readonly Record<string, unknown>[] }) => {
      providers.set(info["id"] as string, { info, models: [...models] })
    },
    remove: (providerID: string) => {
      providers.delete(providerID)
    },
  }
  const modelEditor = {
    default: {
      set: (providerID: string, modelID: string) => {
        modelDefaults.push({ providerID, modelID })
      },
    },
  }

  const ctx = {
    storage: {
      get: (key: string) => kv.get(key),
      set: (key: string, value: unknown) => kv.set(key, value),
      remove: (key: string) => kv.remove(key),
      scan: async (options: { prefix: string }) => ({ entries: await kv.scan(options.prefix) }),
    },
    integration: {
      transform: async (callback: (editor: {
        update(id: string, update: (integration: { id: string; name: string }) => void): void
        method: {
          update(registration: { integrationID: string; method: { type: string; label?: string } }): void
          remove(integrationID: string, method: { type: "key" }): void
        }
        remove(id: string): void
      }) => void) => {
        callback({
          update: (id, update) => {
            update({ id, name: "" })
          },
          method: {
            update: () => {},
            remove: () => {},
          },
          remove: () => {},
        })
        return undefined
      },
      connect: {
        key: async () => {},
      },
      connection: {
        active: async () => undefined,
        resolve: async () => undefined,
      },
    },
    provider: {
      transform: async (callback: (editor: typeof providerEditor) => void) => {
        providerTransforms.push(callback as (editor: never) => void)
        callback(providerEditor as never)
        return {
          dispose: () => {
            disposables.push("provider")
          },
        }
      },
      reload: async () => {
        providerReloads.push(providerReloads.length)
        // Rebuild semantics: a fresh registry replays every stored transform.
        providers.clear()
        for (const callback of providerTransforms) {
          ;(callback as (editor: typeof providerEditor) => void)(providerEditor)
        }
      },
    },
    model: {
      transform: async (
        callback: (editor: { default: { set(providerID: string, modelID: string): void } }) => void,
      ) => {
        modelTransforms.push(callback)
        callback(modelEditor)
        return {
          dispose: () => {
            disposables.push("model")
          },
        }
      },
      reload: async () => {
        for (const callback of modelTransforms) callback(modelEditor)
      },
    },
    session: {
      synthetic: async (input: { sessionID: string; text: string; resume: boolean }) => {
        synthetics.push(input)
      },
      switchModel: async (input: { sessionID: string; model: { providerID: string; id: string } }) => {
        switches.push(input)
      },
    },
    command: {
      transform: async (callback: (editor: { add(definition: RegisteredCommand): void }) => void) => {
        callback({ add: (definition) => commands.push(definition) })
        return {
          dispose: () => {
            disposables.push("command")
          },
        }
      },
    },
    rpc: {
      register: async (_definition: unknown, handlers: Record<string, (input: never) => Promise<unknown>>) => {
        rpcHandlers = handlers as Record<string, (input: never) => Promise<unknown>>
        return {
          dispose: () => {
            disposables.push("rpc")
          },
          events: { emit: () => {} },
        }
      },
    },
  }
  let rpcHandlers: Record<string, (input: never) => Promise<unknown>> = {}

  const run = async (commandName: string, text: string, sessionID = "s1"): Promise<void> => {
    const command = commands.find((c) => c.name === commandName)
    if (command === undefined) throw new Error(`command ${commandName} not registered`)
    await command.execute({ sessionID, prompt: { text } })
  }

  return { ctx, providers, synthetics, switches, modelDefaults, commands, disposables, run, kv, rpc: () => rpcHandlers }
}

function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  )
}

function lastSynthetic(ctx: ReturnType<typeof makeCtx>): string {
  const entry = ctx.synthetics.at(-1)
  expect(entry).toBeDefined()
  return entry?.text ?? ""
}

describe("custom-provider plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("exposes the plugin id and registers commands", async () => {
    expect(PLUGIN_ID).toBe("custom-provider")
    const ctx = makeCtx()
    const cleanup = await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    expect(ctx.commands.map((c) => c.name).sort()).toEqual(["custom-connect", "custom-models"])
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
    await ctx.run("custom-connect", "add id=acme name=Acme base=https://a.dev/v1/ key=sk-1")
    expect(ctx.providers.get("acme")?.info["settings"]).toEqual({ baseURL: "https://a.dev/v1", apiKey: "sk-1" })
    expect(ctx.synthetics.at(-1)?.resume).toBe(false)
    expect(lastSynthetic(ctx)).toContain("- acme (Acme) → https://a.dev/v1 · 2 models · credential saved")
  })

  it("reports status through the command", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-connect", "")
    expect(lastSynthetic(ctx)).toContain("Custom providers:")
  })

  it("edits and removes through the command", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-connect", "edit id=acme name=New")
    expect(ctx.providers.get("acme")?.info["name"]).toBe("New")
    await ctx.run("custom-connect", "edit id=acme key=sk-9")
    expect((ctx.providers.get("acme")?.info["settings"] as Record<string, unknown>)["apiKey"]).toBe("sk-9")
    await ctx.run("custom-connect", "remove id=acme")
    expect(ctx.providers.has("acme")).toBe(false)
    expect(lastSynthetic(ctx)).toContain('Removed custom provider "acme"')
  })

  it("echoes command errors without waking the model", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-connect", "add name=Acme base=not-a-url")
    expect(ctx.synthetics.at(-1)?.resume).toBe(false)
    expect(lastSynthetic(ctx)).toContain("Custom provider error:")
  })

  it("lists models through the custom-models command", async () => {
    stubFetch({ data: [{ id: "m1" }, { id: "m2" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-models", "acme")
    expect(lastSynthetic(ctx)).toBe("Models for acme:\n- acme/m1\n- acme/m2")
  })

  it("lists providers when custom-models has no args", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-models", "")
    expect(lastSynthetic(ctx)).toContain("Custom providers:")
  })

  it("sets the default and switches the session via custom-models default", async () => {
    stubFetch({ data: [{ id: "m1" }, { id: "m2" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-connect", "add name=Acme base=https://a.dev/v1")
    await ctx.run("custom-models", "acme default m2")
    expect(ctx.modelDefaults).toEqual([{ providerID: "acme", modelID: "m2" }])
    expect(ctx.switches).toEqual([{ sessionID: "s1", model: { providerID: "acme", id: "m2" } }])
    expect(lastSynthetic(ctx)).toContain("Default model set to acme/m2")
  })

  it("echoes custom-models errors", async () => {
    stubFetch({ data: [{ id: "m1" }] })
    const ctx = makeCtx()
    await plugin.setup(ctx.ctx as unknown as Parameters<typeof plugin.setup>[0])
    await ctx.run("custom-models", "ghost")
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