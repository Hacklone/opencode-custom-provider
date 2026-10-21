/**
 * Endpoint seam: fetches the model inventory from an OpenAI-compatible
 * endpoint. Implementations treat responses as untrusted and throw hard
 * errors on unreachable endpoints, non-2xx statuses, and malformed payloads.
 */
export interface EndpointClient {
  fetchModels(baseURL: string, apiKey: string | null): Promise<string[]>
}