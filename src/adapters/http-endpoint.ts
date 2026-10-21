import { errorMessage } from "../domain/provider-types.ts"
import { parseModelsResponse } from "../domain/inventory.ts"
import type { EndpointClient } from "../ports/endpoint-client.ts"

const FETCH_TIMEOUT_MS = 15_000

/**
 * Real HTTP endpoint client. The response body is untrusted; any failure
 * (unreachable, non-2xx, malformed payload, empty inventory) throws with a
 * message that tells the user what to fix.
 */
export class HttpEndpointClient implements EndpointClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchModels(baseURL: string, apiKey: string | null): Promise<string[]> {
    const url = `${baseURL}/models`
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          ...(apiKey !== null ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch (error) {
      throw new Error(`could not reach ${url} — ${errorMessage(error)}`)
    }
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403
        ? " — check the API key for this provider"
        : ""
      throw new Error(`GET ${url} failed with HTTP ${response.status}${hint}`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw new Error(`GET ${url} returned invalid JSON — ${errorMessage(error)}`)
    }
    const models = parseModelsResponse(body)
    if (models.length === 0) {
      throw new Error(`GET ${url} reported no models — refusing to save an empty inventory`)
    }
    return models
  }
}