import type { KeyValueStore } from "../ports/key-value.ts"
import type { CredentialStore } from "../ports/credential-store.ts"

const SECRET_PREFIX = "custom-provider-secret/"

/** Minimal structural view of the plugin ctx surfaces used for credentials. */
export interface CredentialContext {
  integration: {
    transform(callback: (editor: IntegrationEditor) => void): Promise<unknown>
    connect: {
      key(input: { integrationID: string; key: string }): Promise<void>
    }
    connection: {
      active(integrationID: string): Promise<unknown>
      resolve(connection: unknown): Promise<unknown>
    }
  }
}

export interface IntegrationEditor {
  update(id: string, update: (integration: { id: string; name: string }) => void): void
  method: {
    update(registration: { integrationID: string; method: { type: "key"; label?: string } }): void
    remove(integrationID: string, method: { type: "key" }): void
  }
  remove(id: string): void
}

const KEY_FIELDS = ["key", "apiKey", "api_key", "value", "secret", "token"] as const

/**
 * Credential storage with a dual write (ADR 0001): the safe store via
 * `ctx.integration.connect.key` (visible in /connect and `opencode auth
 * list`) plus a plugin-storage fallback, because integration upsert semantics
 * are not guaranteed. Resolution order: integration connection first, storage
 * fallback second. Secrets are never logged.
 */
export class OpencodeCredentials implements CredentialStore {
  constructor(
    private readonly ctx: CredentialContext | null,
    private readonly kv: KeyValueStore,
  ) {}

  async save(id: string, key: string | null): Promise<void> {
    if (key === null) {
      // Keyless: drop the storage fallback. An integration credential, if any
      // exists from an earlier rotation, is simply not referenced anymore.
      await this.forget(id)
      return
    }
    this.kv.set(SECRET_PREFIX + id, key)
    if (this.ctx === null) return
    try {
      // Best effort: register the integration so /connect lists it, then save
      // the key into the safe store. If either fails, the storage fallback
      // already holds the secret.
      await this.ensureRegistered(id)
      await this.ctx.integration.connect.key({ integrationID: id, key })
    } catch {
      // Integration probing is best effort; the storage fallback is deterministic.
    }
  }

  async ensureRegistered(id: string): Promise<void> {
    if (this.ctx === null) return
    try {
      await this.ctx.integration.transform((editor) => {
        editor.update(id, (integration) => {
          integration.name = integrationDisplayName(id)
        })
        editor.method.update({ integrationID: id, method: { type: "key", label: "API key" } })
      })
    } catch {
      // Best effort; resolution still works from the storage fallback.
    }
  }

  async resolve(id: string): Promise<string | null> {
    if (this.ctx !== null) {
      try {
        const connection = await this.ctx.integration.connection.active(id)
        if (connection !== undefined && connection !== null) {
          const credential = await this.ctx.integration.connection.resolve(connection)
          const key = extractKey(credential)
          if (key !== null) return key
        }
      } catch {
        // Fall through to the storage fallback.
      }
    }
    const fallback = await this.kv.get(SECRET_PREFIX + id)
    return typeof fallback === "string" && fallback.length > 0 ? fallback : null
  }

  async forget(id: string): Promise<void> {
    await this.kv.remove(SECRET_PREFIX + id)
  }

  async deregister(id: string): Promise<void> {
    if (this.ctx === null) return
    try {
      await this.ctx.integration.transform((editor) => {
        editor.remove(id)
      })
    } catch {
      // Best effort; a leftover integration is harmless.
    }
  }
}

export function integrationDisplayName(id: string): string {
  return `custom-provider: ${id}`
}

/** Pulls the key out of an unknown-shape resolved credential. */
export function extractKey(credential: unknown): string | null {
  if (typeof credential === "string" && credential.length > 0) return credential
  if (typeof credential !== "object" || credential === null) return null
  const record = credential as Record<string, unknown>
  for (const field of KEY_FIELDS) {
    const value = record[field]
    if (typeof value === "string" && value.length > 0) return value
  }
  return null
}