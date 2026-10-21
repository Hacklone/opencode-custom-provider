import { slugify } from "../domain/provider-types.ts"
import type { CustomProviderDef } from "../domain/provider-types.ts"
import type { KeyValueStore } from "../ports/key-value.ts"
import type { ProviderStore, ProviderRecord } from "../ports/provider-store.ts"

const PREFIX = "custom-provider/"

/**
 * Persists one record per provider at key `custom-provider/<id>`, holding the
 * definition and the last-known inventory (offline restore at setup).
 */
export class StorageProviderStore implements ProviderStore {
  constructor(private readonly kv: KeyValueStore) {}

  async list(): Promise<ProviderRecord[]> {
    const records: ProviderRecord[] = []
    for (const entry of await this.kv.scan(PREFIX)) {
      const record = normalize(entry.value)
      if (record !== null) records.push(record)
    }
    records.sort((a, b) => a.def.id.localeCompare(b.def.id))
    return records
  }

  async get(id: string): Promise<ProviderRecord | undefined> {
    const value = await this.kv.get(PREFIX + id)
    if (value === undefined) return undefined
    return normalize(value) ?? undefined
  }

  async save(record: ProviderRecord): Promise<void> {
    await this.kv.set(PREFIX + record.def.id, { ...record.def, models: record.models })
  }

  async remove(id: string): Promise<void> {
    await this.kv.remove(PREFIX + id)
  }
}

/** Storage is our own writes, but tolerate corrupt entries by dropping them. */
function normalize(value: unknown): ProviderRecord | null {
  if (typeof value !== "object" || value === null) return null
  const raw = value as Record<string, unknown>
  const id = raw["id"]
  const name = raw["name"]
  const baseURL = raw["baseURL"]
  const models = raw["models"]
  if (typeof id !== "string" || typeof name !== "string" || typeof baseURL !== "string" || !Array.isArray(models)) {
    return null
  }
  const def: CustomProviderDef = { id: slugify(id), name, baseURL }
  return { def, models: models.filter((m): m is string => typeof m === "string") }
}