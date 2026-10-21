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

export function validateName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new ProviderInputError("name must not be empty")
  }
  if (trimmed.length > 128) {
    throw new ProviderInputError(`name exceeds 128 characters: got ${trimmed.length}`)
  }
  return trimmed
}

export function validateBaseURL(raw: string): string {
  const trimmed = raw.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new ProviderInputError(`base "${trimmed}" is not a valid URL`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProviderInputError(`base "${trimmed}" must use http or https`)
  }
  return trimmed.replace(/\/+$/, "")
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}