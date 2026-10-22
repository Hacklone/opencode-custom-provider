import { describe, expect, it } from "vitest"
import { OpencodeCredentials, extractKey, integrationDisplayName } from "../../src/opencode/credentials.ts"
import type { IntegrationEditor } from "../../src/opencode/credentials.ts"
import { MemoryKv } from "../fakes.ts"

interface EditorCalls {
  updated: { id: string; name: string }[]
  methods: { integrationID: string; method: { type: string; label?: string } }[]
  removed: string[]
}

function makeCtx(options: {
  active?: unknown
  resolveValue?: unknown
  transformThrows?: boolean
  connectThrows?: boolean
  activeThrows?: boolean
}) {
  const editors: EditorCalls = { updated: [], methods: [], removed: [] }
  const connected: { integrationID: string; key: string }[] = []
  const ctx = {
    integration: {
      transform: async (callback: (editor: IntegrationEditor) => void) => {
        if (options.transformThrows === true) throw new Error("transform down")
        callback({
          update: (id, update) => {
            const integration = { id, name: "" }
            update(integration)
            editors.updated.push(integration)
          },
          method: {
            update: (registration) => {
              editors.methods.push(registration)
            },
            remove: () => {},
          },
          remove: (id: string) => {
            editors.removed.push(id)
          },
        })
        return undefined
      },
      connect: {
        key: async (input: { integrationID: string; key: string }) => {
          if (options.connectThrows === true) throw new Error("connect down")
          connected.push(input)
        },
      },
      connection: {
        active: async () => {
          if (options.activeThrows === true) throw new Error("active down")
          return options.active
        },
        resolve: async () => options.resolveValue,
      },
    },
  }
  return { ctx, editors, connected }
}

describe("OpencodeCredentials.save", () => {
  it("registers the integration and saves the key to the safe store", async () => {
    const { ctx, editors, connected } = makeCtx({})
    const kv = new MemoryKv()
    const credentials = new OpencodeCredentials(ctx, kv)
    await credentials.save("acme", "sk-1")
    expect(editors.updated).toEqual([{ id: "acme", name: integrationDisplayName("acme") }])
    expect(editors.methods).toEqual([{ integrationID: "acme", method: { type: "key", label: "API key" } }])
    expect(connected).toEqual([{ integrationID: "acme", key: "sk-1" }])
    expect(await kv.get("custom-provider-secret/acme")).toBe("sk-1")
  })

  it("keeps the storage fallback when the integration path throws", async () => {
    const { ctx } = makeCtx({ transformThrows: true })
    const kv = new MemoryKv()
    const credentials = new OpencodeCredentials(ctx, kv)
    await credentials.save("acme", "sk-1")
    expect(await kv.get("custom-provider-secret/acme")).toBe("sk-1")
  })

  it("keeps the storage fallback when connect.key throws", async () => {
    const { ctx } = makeCtx({ connectThrows: true })
    const kv = new MemoryKv()
    const credentials = new OpencodeCredentials(ctx, kv)
    await credentials.save("acme", "sk-1")
    expect(await kv.get("custom-provider-secret/acme")).toBe("sk-1")
  })

  it("works without a plugin context", async () => {
    const kv = new MemoryKv()
    const credentials = new OpencodeCredentials(null, kv)
    await credentials.save("acme", "sk-1")
    expect(await kv.get("custom-provider-secret/acme")).toBe("sk-1")
  })

  it("clears the storage fallback for keyless saves", async () => {
    const { ctx } = makeCtx({})
    const kv = new MemoryKv()
    const credentials = new OpencodeCredentials(ctx, kv)
    await credentials.save("acme", "sk-1")
    await credentials.save("acme", null)
    expect(await kv.get("custom-provider-secret/acme")).toBeUndefined()
  })
})

describe("OpencodeCredentials.ensureRegistered", () => {
  it("registers the integration without saving a key", async () => {
    const { ctx, editors, connected } = makeCtx({})
    const credentials = new OpencodeCredentials(ctx, new MemoryKv())
    await credentials.ensureRegistered("acme")
    expect(editors.updated).toEqual([{ id: "acme", name: integrationDisplayName("acme") }])
    expect(editors.methods).toEqual([{ integrationID: "acme", method: { type: "key", label: "API key" } }])
    expect(connected).toEqual([])
  })

  it("tolerates a failing transform", async () => {
    const { ctx } = makeCtx({ transformThrows: true })
    const credentials = new OpencodeCredentials(ctx, new MemoryKv())
    await expect(credentials.ensureRegistered("acme")).resolves.toBeUndefined()
  })

  it("does nothing without a plugin context", async () => {
    const credentials = new OpencodeCredentials(null, new MemoryKv())
    await expect(credentials.ensureRegistered("acme")).resolves.toBeUndefined()
  })
})

describe("OpencodeCredentials.resolve", () => {
  it("resolves through the integration connection", async () => {
    const { ctx } = makeCtx({ active: { id: "c1" }, resolveValue: { key: "sk-live" } })
    const credentials = new OpencodeCredentials(ctx, new MemoryKv())
    expect(await credentials.resolve("acme")).toBe("sk-live")
  })

  it("falls back to storage when no connection is active", async () => {
    const { ctx } = makeCtx({ active: undefined })
    const kv = new MemoryKv()
    const credentials = new OpencodeCredentials(ctx, kv)
    await kv.set("custom-provider-secret/acme", "sk-stored")
    expect(await credentials.resolve("acme")).toBe("sk-stored")
  })

  it("falls back to storage when the connection has no recognizable key", async () => {
    const { ctx } = makeCtx({ active: { id: "c1" }, resolveValue: { unrelated: true } })
    const kv = new MemoryKv()
    const credentials = new OpencodeCredentials(ctx, kv)
    await kv.set("custom-provider-secret/acme", "sk-stored")
    expect(await credentials.resolve("acme")).toBe("sk-stored")
  })

  it("falls back to storage when integration probing throws", async () => {
    const { ctx } = makeCtx({ activeThrows: true })
    const kv = new MemoryKv()
    const credentials = new OpencodeCredentials(ctx, kv)
    await kv.set("custom-provider-secret/acme", "sk-stored")
    expect(await credentials.resolve("acme")).toBe("sk-stored")
  })

  it("returns null for keyless providers", async () => {
    const { ctx } = makeCtx({ active: undefined })
    const credentials = new OpencodeCredentials(ctx, new MemoryKv())
    expect(await credentials.resolve("acme")).toBeNull()
  })

  it("ignores an empty storage fallback", async () => {
    const { ctx } = makeCtx({ active: undefined })
    const kv = new MemoryKv()
    await kv.set("custom-provider-secret/acme", "")
    const credentials = new OpencodeCredentials(ctx, kv)
    expect(await credentials.resolve("acme")).toBeNull()
  })

  it("resolves without a plugin context", async () => {
    const kv = new MemoryKv()
    await kv.set("custom-provider-secret/acme", "sk-stored")
    const credentials = new OpencodeCredentials(null, kv)
    expect(await credentials.resolve("acme")).toBe("sk-stored")
  })
})

describe("OpencodeCredentials.remove", () => {
  it("drops the fallback and best-effort removes the integration", async () => {
    const { ctx, editors } = makeCtx({})
    const kv = new MemoryKv()
    await kv.set("custom-provider-secret/acme", "sk-1")
    const credentials = new OpencodeCredentials(ctx, kv)
    await credentials.remove("acme")
    expect(await kv.get("custom-provider-secret/acme")).toBeUndefined()
    expect(editors.removed).toEqual(["acme"])
  })

  it("tolerates a failing integration removal", async () => {
    const { ctx } = makeCtx({ transformThrows: true })
    const credentials = new OpencodeCredentials(ctx, new MemoryKv())
    await expect(credentials.remove("acme")).resolves.toBeUndefined()
  })

  it("works without a plugin context", async () => {
    const kv = new MemoryKv()
    await kv.set("custom-provider-secret/acme", "sk-1")
    const credentials = new OpencodeCredentials(null, kv)
    await credentials.remove("acme")
    expect(await kv.get("custom-provider-secret/acme")).toBeUndefined()
  })
})

describe("extractKey", () => {
  it("probes the known credential fields", () => {
    expect(extractKey({ key: "a" })).toBe("a")
    expect(extractKey({ apiKey: "b" })).toBe("b")
    expect(extractKey({ api_key: "c" })).toBe("c")
    expect(extractKey({ value: "d" })).toBe("d")
    expect(extractKey({ secret: "e" })).toBe("e")
    expect(extractKey({ token: "f" })).toBe("f")
  })

  it("accepts a bare string credential", () => {
    expect(extractKey("raw-key")).toBe("raw-key")
  })

  it("returns null for unrecognizable shapes", () => {
    expect(extractKey({})).toBeNull()
    expect(extractKey({ key: "" })).toBeNull()
    expect(extractKey(null)).toBeNull()
    expect(extractKey(42)).toBeNull()
  })
})