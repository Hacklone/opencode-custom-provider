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

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}