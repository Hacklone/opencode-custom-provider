import { describe, expect, it } from "vitest"
import { HttpEndpointClient } from "../../src/adapters/http-endpoint.ts"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("HttpEndpointClient.fetchModels", () => {
  it("GETs {base}/models with a Bearer header and parses the OpenAI shape", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const client = new HttpEndpointClient(async (input: string | URL | Request, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      return jsonResponse({ data: [{ id: "a" }, { id: "b" }, { id: "a" }] })
    })
    expect(await client.fetchModels("https://api.dev/v1", "sk-1")).toEqual(["a", "b"])
    expect(calls[0]?.url).toBe("https://api.dev/v1/models")
    expect((calls[0]?.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-1")
  })

  it("omits the Authorization header for keyless endpoints", async () => {
    const calls: { init: RequestInit }[] = []
    const client = new HttpEndpointClient(async (_url, init) => {
      calls.push({ init: init ?? {} })
      return jsonResponse({ data: [{ id: "a" }] })
    })
    await client.fetchModels("https://api.dev/v1", null)
    expect((calls[0]?.init.headers as Record<string, string>)["Authorization"]).toBeUndefined()
  })

  it("reads a bare-array response", async () => {
    const client = new HttpEndpointClient(async () => jsonResponse([{ id: "x" }]))
    expect(await client.fetchModels("https://api.dev/v1", null)).toEqual(["x"])
  })

  it("reports unreachable endpoints with the URL", async () => {
    const client = new HttpEndpointClient(async () => {
      throw new Error("ECONNREFUSED")
    })
    await expect(client.fetchModels("https://api.dev/v1", null)).rejects.toThrow(
      /could not reach https:\/\/api\.dev\/v1\/models — ECONNREFUSED/,
    )
  })

  it("hints at the API key on 401", async () => {
    const client = new HttpEndpointClient(async () => jsonResponse({}, 401))
    await expect(client.fetchModels("https://api.dev/v1", "sk-bad")).rejects.toThrow(/check the API key/)
  })

  it("hints at the API key on 403", async () => {
    const client = new HttpEndpointClient(async () => jsonResponse({}, 403))
    await expect(client.fetchModels("https://api.dev/v1", "sk-bad")).rejects.toThrow(/HTTP 403 — check the API key/)
  })

  it("reports other statuses without the key hint", async () => {
    const client = new HttpEndpointClient(async () => jsonResponse({}, 500))
    await expect(client.fetchModels("https://api.dev/v1", null)).rejects.toThrow(/HTTP 500/)
    await expect(client.fetchModels("https://api.dev/v1", null)).rejects.toThrow(
      expect.not.stringContaining("check the API key"),
    )
  })

  it("reports invalid JSON bodies", async () => {
    const client = new HttpEndpointClient(async () => jsonResponse("not json at all"))
    await expect(client.fetchModels("https://api.dev/v1", null)).rejects.toThrow(/invalid JSON/)
  })

  it("refuses an empty inventory", async () => {
    const client = new HttpEndpointClient(async () => jsonResponse({ data: [] }))
    await expect(client.fetchModels("https://api.dev/v1", null)).rejects.toThrow(/reported no models/)
  })

  it("propagates malformed payload errors", async () => {
    const client = new HttpEndpointClient(async () => jsonResponse({ data: [{ id: 7 }] }))
    await expect(client.fetchModels("https://api.dev/v1", null)).rejects.toThrow(/entry 0 id/)
  })
})