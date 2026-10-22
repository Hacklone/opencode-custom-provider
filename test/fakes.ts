import type { KeyValueStore } from "../src/ports/key-value.ts"
import type { CredentialStore } from "../src/ports/credential-store.ts"
import type { EndpointClient } from "../src/ports/endpoint-client.ts"
import type { ModelCatalog } from "../src/ports/catalog.ts"
import type { SessionControl } from "../src/ports/session-control.ts"
import type { CustomProviderDef } from "../src/domain/provider-types.ts"
import type { ModelSeed } from "../src/domain/inventory.ts"

/** Deterministic in-memory KV store mirroring the storage port. */
export class MemoryKv implements KeyValueStore {
  private readonly map = new Map<string, unknown>()

  async get(key: string): Promise<unknown> {
    const value = this.map.get(key)
    return value === undefined ? undefined : structuredClone(value)
  }

  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value))
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key)
  }

  async scan(prefix: string): Promise<{ key: string; value: unknown }[]> {
    const entries: { key: string; value: unknown }[] = []
    for (const [key, value] of this.map.entries()) {
      if (key.startsWith(prefix)) entries.push({ key, value: structuredClone(value) })
    }
    return entries
  }
}

export class FakeCredentials implements CredentialStore {
  readonly saved: { id: string; key: string | null }[] = []
  readonly ensured: string[] = []
  readonly forgotten: string[] = []
  readonly deregistered: string[] = []
  private readonly keys = new Map<string, string | null>()

  async save(id: string, key: string | null): Promise<void> {
    this.saved.push({ id, key })
    if (key === null) this.keys.delete(id)
    else this.keys.set(id, key)
  }

  async resolve(id: string): Promise<string | null> {
    return this.keys.get(id) ?? null
  }

  async forget(id: string): Promise<void> {
    this.forgotten.push(id)
    this.keys.delete(id)
  }

  async deregister(id: string): Promise<void> {
    this.deregistered.push(id)
  }

  async ensureRegistered(id: string): Promise<void> {
    this.ensured.push(id)
  }
}

export class FakeEndpoint implements EndpointClient {
  calls: { baseURL: string; apiKey: string | null }[] = []
  result: string[] | Error = []

  async fetchModels(baseURL: string, apiKey: string | null): Promise<string[]> {
    this.calls.push({ baseURL, apiKey })
    if (this.result instanceof Error) throw this.result
    return [...this.result]
  }
}

export class FakeCatalog implements ModelCatalog {
  registered: { def: CustomProviderDef; seeds: ModelSeed[] }[] = []
  unregistered: string[] = []

  async register(def: CustomProviderDef, seeds: readonly ModelSeed[]): Promise<void> {
    this.registered.push({ def, seeds: [...seeds] })
  }

  async unregister(id: string): Promise<void> {
    this.unregistered.push(id)
  }
}

export class FakeSession implements SessionControl {
  defaults: { providerID: string; modelID: string }[] = []

  async setDefault(providerID: string, modelID: string): Promise<void> {
    this.defaults.push({ providerID, modelID })
  }
}