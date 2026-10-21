import type { CustomProviderDef } from "../domain/provider-types.ts"

/**
 * Persisted Custom Provider record. The model list is the last-known
 * inventory, persisted so setup can restore providers offline with zero
 * network calls.
 */
export interface ProviderRecord {
  def: CustomProviderDef
  models: string[]
}

export interface ProviderStore {
  list(): Promise<ProviderRecord[]>
  get(id: string): Promise<ProviderRecord | undefined>
  save(record: ProviderRecord): Promise<void>
  remove(id: string): Promise<void>
}