/**
 * Catalog-default seam: points OpenCode's default model at a custom
 * provider's model (used for auto-default on add).
 */
export interface SessionControl {
  setDefault(providerID: string, modelID: string): Promise<void>
}