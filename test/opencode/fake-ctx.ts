/**
 * Shared fake plugin context for server-side wiring tests. Mirrors only the
 * surfaces src/opencode/plugin.ts touches; reload() replays stored transforms
 * onto a fresh registry to match OpenCode's rebuild semantics.
 */
import { expect, vi } from "vitest"
import { MemoryKv } from "../fakes.ts"

export interface RegisteredCommand {
  name: string
  execute(input: { sessionID: string; prompt: { text: string } }): Promise<void>
}

/** Invokes a captured rpc handler by name with a checked lookup. Handlers
 * receive a context whose `error()` returns a tagged error object, mirroring
 * the runtime convention (declared errors surface to clients as {type,message}). */
export async function rpcCall<T>(
  rpc: Record<string, (input: never, context: never) => Promise<unknown>>,
  name: string,
  input: unknown,
): Promise<T> {
  const handler = rpc[name]
  if (handler === undefined) throw new Error(`missing rpc handler ${name}`)
  const context = {
    signal: new AbortController().signal,
    error: (type: string, message: string, data?: Record<string, unknown>) => ({
      __rpcError: true,
      type,
      message,
      data,
    }),
  }
  return (await handler(input as never, context as never)) as T
}

export function makeCtx(seed: Record<string, unknown> = {}) {
  const kv = new MemoryKv()
  for (const [key, value] of Object.entries(seed)) void kv.set(key, value)

  const providers = new Map<string, { info: Record<string, unknown>; models: Record<string, unknown>[] }>()
  const providerTransforms: ((editor: never) => void)[] = []
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
      register: async (_definition: unknown, handlers: Record<string, (input: never, context: never) => Promise<unknown>>) => {
        rpcHandlers = handlers as Record<string, (input: never, context: never) => Promise<unknown>>
        return {
          dispose: () => {
            disposables.push("rpc")
          },
          events: { emit: () => {} },
        }
      },
    },
  }
  let rpcHandlers: Record<string, (input: never, context: never) => Promise<unknown>> = {}

  const run = async (commandName: string, text: string, sessionID = "s1"): Promise<void> => {
    const command = commands.find((c) => c.name === commandName)
    if (command === undefined) throw new Error(`command ${commandName} not registered`)
    await command.execute({ sessionID, prompt: { text } })
  }

  return {
    ctx,
    providers,
    synthetics,
    switches,
    modelDefaults,
    commands,
    disposables,
    run,
    kv,
    rpc: () => rpcHandlers,
  }
}

export function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  )
}

export function lastSynthetic(ctx: ReturnType<typeof makeCtx>): string {
  const entry = ctx.synthetics.at(-1)
  expect(entry).toBeDefined()
  return entry?.text ?? ""
}