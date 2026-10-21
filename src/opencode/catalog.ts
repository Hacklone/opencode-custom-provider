import { Integration, Model, Provider } from "@opencode/plugin"
import { FALLBACK_CONTEXT_LIMIT, FALLBACK_OUTPUT_LIMIT } from "../domain/inventory.ts"
import type { ModelSeed } from "../domain/inventory.ts"
import type { CustomProviderDef } from "../domain/provider-types.ts"
import type { ModelCatalog } from "../ports/catalog.ts"
import type { CredentialStore } from "../ports/credential-store.ts"

export const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible"

/** Minimal structural view of ctx.provider used by the catalog. */
export interface CatalogContext {
  provider: {
    transform(callback: (editor: CatalogProviderEditor) => void): Promise<{ dispose(): void }>
    reload(): Promise<void>
  }
}

export interface CatalogProviderEditor {
  get(providerID: string): { provider: { id: string } } | undefined
  add(input: { info: Record<string, unknown>; models: readonly Record<string, unknown>[] }): void
  remove(providerID: string): void
}

interface CatalogPayload {
  def: CustomProviderDef
  seeds: readonly ModelSeed[]
  apiKey: string | null
}

/**
 * Publishes Custom Providers to OpenCode through ONE provider transform
 * registered at setup. Registry rebuilds are fresh replays of that transform,
 * so `register`/`unregister` only mutate the in-memory payload map and reload
 * — registering a new transform per change would accumulate replays forever.
 * Credentials are resolved BEFORE the reload because the transform callback is
 * synchronous; a stored payload replays verbatim on external rebuilds and is
 * refreshed on every register (ADR 0001 re-embedding rule).
 */
export class OpencodeCatalog implements ModelCatalog {
  private readonly payloads = new Map<string, CatalogPayload>()

  constructor(
    private readonly ctx: CatalogContext,
    private readonly credentials: CredentialStore,
  ) {}

  /** Registers the single replaying transform. Call once at setup. */
  bootstrap(): Promise<{ dispose(): void }> {
    return this.ctx.provider.transform((editor) => {
      this.publishInto(editor)
    })
  }

  async register(def: CustomProviderDef, seeds: readonly ModelSeed[]): Promise<void> {
    await this.publishOne({ def, seeds })
    await this.ctx.provider.reload()
  }

  async unregister(id: string): Promise<void> {
    this.payloads.delete(id)
    await this.ctx.provider.reload()
  }

  private async publishOne(input: Omit<CatalogPayload, "apiKey">): Promise<void> {
    this.payloads.set(input.def.id, {
      ...input,
      apiKey: await this.credentials.resolve(input.def.id),
    })
  }

  private publishInto(editor: CatalogProviderEditor): void {
    for (const { def, seeds, apiKey } of this.payloads.values()) {
      // A config-defined provider with the same id would otherwise duplicate.
      if (editor.get(def.id) !== undefined) editor.remove(def.id)
      editor.add({ info: providerInfo(def, apiKey), models: seeds.map((seed) => modelInfo(def.id, seed)) })
    }
  }
}

function providerInfo(def: CustomProviderDef, apiKey: string | null): Record<string, unknown> {
  const providerID = Provider.ID.make(def.id)
  const info: Record<string, unknown> = {
    ...Provider.Info.empty(providerID),
    name: def.name,
    activation: "enabled",
    package: OPENAI_COMPATIBLE_PACKAGE,
    settings: { baseURL: def.baseURL, ...(apiKey !== null ? { apiKey } : {}) },
  }
  if (apiKey !== null) {
    // Link the provider to its /connect-managed integration only when a
    // credential exists; a keyless endpoint has no credential to resolve.
    info["integrationID"] = Integration.ID.make(def.id)
  }
  return info
}

function modelInfo(providerID: string, seed: ModelSeed): Record<string, unknown> {
  return {
    ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make(seed.id)),
    name: Model.ID.make(seed.name),
    limit: { context: FALLBACK_CONTEXT_LIMIT, output: FALLBACK_OUTPUT_LIMIT },
  }
}