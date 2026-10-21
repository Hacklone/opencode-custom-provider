/**
 * Inventory parsing: normalizes the untrusted `GET {baseURL}/v1/models`
 * response into model seeds. Platform-pure — the opencode adapter maps seeds
 * onto Model.Info.
 */

export interface ModelSeed {
  id: string
  /** Model.Info.name; the /v1/models payload carries no display names. */
  name: string
}

/** OpenCode's fallbacks for uncatalogued models (V2 docs, Models page). */
export const FALLBACK_CONTEXT_LIMIT = 200_000
export const FALLBACK_OUTPUT_LIMIT = 32_000

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`)
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${what} must be an array`)
  }
  return value
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${what} must be a non-empty string`)
  }
  return value
}

/**
 * Accepts the OpenAI shape `{ data: [{ id }] }` or a bare array of entries.
 * A malformed payload is a hard error naming the offending location.
 */
export function parseModelsResponse(body: unknown): string[] {
  let entries: unknown
  if (Array.isArray(body)) {
    entries = body
  } else {
    entries = asRecord(body, "models response")["data"]
  }
  const list = asArray(entries, "models response data")
  const ids: string[] = []
  for (const [index, entry] of list.entries()) {
    const record = asRecord(entry, `models response entry ${index}`)
    const id = asString(record["id"], `models response entry ${index} id`)
    ids.push(id)
  }
  return [...new Set(ids)]
}

export function seedsFromIds(ids: readonly string[]): ModelSeed[] {
  return ids.map((id) => ({ id, name: id }))
}