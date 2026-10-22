import { ProviderInputError, slugify, validateProviderId, normalizeBaseURL, errorMessage } from "../domain/provider-types.ts"
import { seedsFromIds } from "../domain/inventory.ts"
import type { ProviderStore, ProviderRecord } from "../ports/provider-store.ts"
import type { CredentialStore } from "../ports/credential-store.ts"
import type { EndpointClient } from "../ports/endpoint-client.ts"
import type { ModelCatalog } from "../ports/catalog.ts"
import type { SessionControl } from "../ports/session-control.ts"

export interface AddProviderInput {
  /** Optional explicit id; derived from the name when absent. */
  id?: string
  name: string
  baseURL: string
  /** null/undefined = keyless endpoint. */
  key?: string | null
}

export interface EditProviderInput {
  name?: string
  baseURL?: string
}

export interface ProviderStatus {
  id: string
  name: string
  baseURL: string
  modelCount: number
  hasCredential: boolean
  /** Reason the last inventory fetch failed; absent = the endpoint was healthy. */
  lastError?: string
}

export interface CustomProviderServiceDeps {
  store: ProviderStore
  credentials: CredentialStore
  endpoint: EndpointClient
  catalog: ModelCatalog
  session: SessionControl
}

/**
 * All Custom Provider mutations flow through this service: both the TUI (via
 * RPC) and the server commands call the same methods, so behavior cannot
 * drift between clients.
 */
export class CustomProviderService {
  constructor(private readonly deps: CustomProviderServiceDeps) {}

  /** Offline-tolerant setup restore: registers stored providers with their persisted inventory; zero network. */
  async restoreAll(): Promise<void> {
    for (const record of await this.deps.store.list()) {
      await this.deps.catalog.register(record.def, seedsFromIds(record.models))
      // Re-expose the integration to /connect: registration otherwise only
      // happens inside credentials.save, so a restart would hide the provider
      // from /connect until a key edit (verified live 2026-10-22).
      await this.deps.credentials.ensureRegistered(record.def.id)
    }
  }

  async add(input: AddProviderInput): Promise<ProviderStatus> {
    const name = requireNonEmpty(input.name, "name")
    const id = deriveId(input.id ?? name)
    if ((await this.deps.store.get(id)) !== undefined) {
      throw new ProviderInputError(`id "${id}" already exists — choose a different id`)
    }
    const baseURL = normalizeBaseURL(input.baseURL)
    const key = requireKey(input.key)
    // Validate-before-save: a failing inventory fetch aborts the whole save.
    const models = await this.deps.endpoint.fetchModels(baseURL, key)
    const def = { id, name, baseURL }
    await this.deps.credentials.save(id, key)
    await this.deps.store.save({ def, models })
    await this.deps.catalog.register(def, seedsFromIds(models))
    // Auto-default (user request): a freshly added provider must be usable
    // immediately — its first model becomes the catalog default for new
    // sessions. fetchModels refuses an empty inventory, so the first model
    // always exists here.
    await this.setDefault(id, models[0]!)
    return this.statusFor(def, models, key !== null, undefined)
  }

  async edit(id: string, patch: EditProviderInput): Promise<ProviderStatus> {
    const record = await this.require(id)
    if (patch.name === undefined && patch.baseURL === undefined) {
      throw new ProviderInputError("edit needs at least one of name or base")
    }
    const def = { ...record.def }
    if (patch.name !== undefined) def.name = requireNonEmpty(patch.name, "name")
    // Normalize BEFORE comparing so a cosmetic-only change (e.g. a trailing
    // slash) does not trigger a spurious inventory refetch.
    const nextBaseURL = patch.baseURL !== undefined ? normalizeBaseURL(patch.baseURL) : undefined
    const baseURLChanged = nextBaseURL !== undefined && nextBaseURL !== record.def.baseURL
    if (nextBaseURL !== undefined) def.baseURL = nextBaseURL
    // baseURL change => immediate refetch with the resolved credential (key
    // rotation is delegated to /connect, whose active credential resolve()
    // sees instantly).
    let models = record.models
    if (baseURLChanged) {
      const effectiveKey = await this.deps.credentials.resolve(id)
      try {
        models = await this.deps.endpoint.fetchModels(def.baseURL, effectiveKey)
      } catch (error) {
        // The stored definition is untouched, but the endpoint is now known
        // to be unhealthy — record it so every client can show the state.
        await this.deps.store.save({ def: record.def, models: record.models, lastError: errorMessage(error) })
        throw error
      }
    }
    await this.deps.store.save({ def, models })
    await this.deps.catalog.register(def, seedsFromIds(models))
    const hasCredential = (await this.deps.credentials.resolve(id)) !== null
    return this.statusFor(def, models, hasCredential, undefined)
  }

  async remove(id: string): Promise<{ hadCredential: boolean }> {
    await this.require(id)
    // Safe-store credentials cannot be deleted by a plugin (ctx.credential
    // exposes only `activate`; integration editor.remove does not cascade).
    // When a key exists the integration registration is deliberately KEPT so
    // the saved accounts stay manageable via /connect and `opencode auth
    // logout` — callers surface the leftover to the user.
    const hadCredential = (await this.deps.credentials.resolve(id)) !== null
    await this.deps.store.remove(id)
    await this.deps.credentials.forget(id)
    if (!hadCredential) await this.deps.credentials.deregister(id)
    await this.deps.catalog.unregister(id)
    return { hadCredential }
  }

  /**
   * Explicit refresh. On failure the stored inventory is kept untouched, the
   * failure reason is persisted as the provider's health, and the error
   * propagates to the caller for display.
   */
  async refresh(id: string): Promise<string[]> {
    const record = await this.require(id)
    const key = await this.deps.credentials.resolve(id)
    let models: string[]
    try {
      models = await this.deps.endpoint.fetchModels(record.def.baseURL, key)
    } catch (error) {
      await this.deps.store.save({ def: record.def, models: record.models, lastError: errorMessage(error) })
      throw error
    }
    await this.deps.store.save({ def: record.def, models })
    await this.deps.catalog.register(record.def, seedsFromIds(models))
    return models
  }

  async list(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = []
    for (const record of await this.deps.store.list()) {
      const hasCredential = (await this.deps.credentials.resolve(record.def.id)) !== null
      statuses.push(this.statusFor(record.def, record.models, hasCredential, record.lastError))
    }
    return statuses
  }

  /** Internal: points the catalog default at a validated model (auto-default on add). */
  private async setDefault(providerID: string, modelID: string): Promise<void> {
    await this.deps.session.setDefault(providerID, modelID)
  }

  private async require(id: string): Promise<ProviderRecord> {
    const record = await this.deps.store.get(id)
    if (record === undefined) {
      throw new ProviderInputError(`no custom provider with id "${id}" — run /custom-connect to list providers`)
    }
    return record
  }

  private statusFor(def: ProviderRecord["def"], models: string[], hasCredential: boolean, lastError: string | undefined): ProviderStatus {
    const status: ProviderStatus = { id: def.id, name: def.name, baseURL: def.baseURL, modelCount: models.length, hasCredential }
    if (lastError !== undefined) status.lastError = lastError
    return status
  }
}

function requireNonEmpty(raw: string, field: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new ProviderInputError(`${field} must not be empty`)
  }
  return trimmed
}

function deriveId(raw: string): string {
  const candidate = slugify(raw)
  if (candidate.length === 0) {
    throw new ProviderInputError(`id derived from "${raw}" is empty — provide id=<id> explicitly`)
  }
  return validateProviderId(candidate)
}

function requireKey(key: string | null | undefined): string | null {
  if (key === undefined || key === null) return null
  const trimmed = key.trim()
  if (trimmed.length === 0) {
    throw new ProviderInputError("key must not be blank — omit it for a keyless endpoint")
  }
  return trimmed
}