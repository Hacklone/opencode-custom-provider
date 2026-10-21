import type { CustomProviderDef } from "../domain/provider-types.ts"
import type { ModelSeed } from "../domain/inventory.ts"

/**
 * Catalog seam: makes a Custom Provider (and its inventory) visible to
 * OpenCode, or removes it. Implementations resolve the credential themselves
 * at registration time so the embedded key is always current.
 */
export interface ModelCatalog {
  register(def: CustomProviderDef, models: readonly ModelSeed[]): Promise<void>
  unregister(id: string): Promise<void>
}