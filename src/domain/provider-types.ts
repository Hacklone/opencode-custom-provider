/** Custom Provider vocabulary: definitions, validation, slugification. */

export interface CustomProviderDef {
  /** Stable identifier, slugified, unique among custom providers. */
  id: string
  /** Display name. */
  name: string
  /** OpenAI-compatible base URL, e.g. https://api.example.com/v1 */
  baseURL: string
}

/** Invalid provider input; the message names the offending field. */
export class ProviderInputError extends Error {}

/** Built-in provider IDs that a custom provider must not shadow. */
export const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "opencode", "anthropic", "openai", "google", "azure", "openrouter",
  "bedrock", "vertex", "github-copilot", "groq", "mistral", "xai",
  "deepseek", "vllm", "lmstudio", "ollama",
])

export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function validateProviderId(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new ProviderInputError(
      `id "${id}" must be lowercase letters, digits, or dashes and start with a letter or digit`,
    )
  }
  if (id.length > 64) {
    throw new ProviderInputError(`id "${id}" exceeds 64 characters`)
  }
  if (RESERVED_PROVIDER_IDS.has(id)) {
    throw new ProviderInputError(`id "${id}" is reserved by a built-in provider — choose a different id`)
  }
  return id
}

/**
 * Validates and normalizes a base URL: must be a valid http(s) URL; trailing
 * slashes are stripped so persisted values are stable across edits.
 */
export function normalizeBaseURL(raw: string): string {
  const trimmed = raw.trim()
  if (!/^https?:\/\//.test(trimmed) || !URL.canParse(trimmed)) {
    throw new ProviderInputError(`base "${trimmed}" is not a valid http(s) URL`)
  }
  return trimmed.replace(/\/+$/, "")
}

/**
 * Human-readable error rendering. The RPC client throws plain
 * `{type, message}` objects (not Error instances), so a naive String(error)
 * renders "[object Object]". Known rpc failure types get an actionable hint;
 * anything else is stringified, never "[object Object]".
 */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return describeError("", error.message)
  if (typeof error === "object" && error !== null) {
    const record = error as { message?: unknown; type?: unknown }
    const message = typeof record.message === "string" ? record.message.trim() : ""
    const type = typeof record.type === "string" ? record.type : ""
    if (message.length > 0) return describeError(type, message)
    if (type.length > 0) return describeError(type, type)
    try {
      return JSON.stringify(error)
    } catch {
      // Circular or otherwise unstringifiable throws still deserve words.
      return "unprintable error"
    }
  }
  return String(error)
}

function describeError(type: string, message: string): string {
  if (type === "rpc.unavailable") {
    return "the custom-provider service is not available on this OpenCode server — restart OpenCode so the plugin loads, then try again"
  }
  if (message === "Transport") {
    return "could not reach the OpenCode server — check that it is running"
  }
  // The host's generic rpc failure carries no detail; replace the jargon.
  if (message === "RPC call failed") {
    return "the custom-provider service did not answer — restart OpenCode and try again"
  }
  return message
}