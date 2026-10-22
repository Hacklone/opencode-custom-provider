/**
 * Integration tests for scripts/mock-llm/server.mjs — the dev mock endpoint the
 * plugin's live smoke tests run against. The server is started in-process on an
 * ephemeral loopback port, so these tests are deterministic and never touch an
 * external network (AGENTS.md's "no real network" rule refers to that).
 *
 * The core contract under test: a chat completion reply names the model that
 * served it — in the `model` field AND in the visible reply text — so a manual
 * TUI round-trip proves which model ran.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Server } from "node:http"
import { startMockLlmServer } from "../scripts/mock-llm/server.mjs"

const KEY = "sk-mock-1234"

let server: Server
let base: string

beforeAll(async () => {
  server = await startMockLlmServer({ port: 0 })
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("mock server did not listen on an ephemeral TCP port")
  }
  base = `http://127.0.0.1:${address.port}/v1`
})

afterAll(() => {
  server.close()
})

async function readSse(response: Response): Promise<string[]> {
  const raw = await response.text()
  return raw
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
}

describe("mock LLM server", () => {
  it("rejects /v1/models without the key", async () => {
    const response = await fetch(`${base}/models`)
    expect(response.status).toBe(401)
  })

  it("serves the model inventory with the key", async () => {
    const response = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${KEY}` } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: Array<{ id: string }> }
    expect(body.data.map((entry) => entry.id)).toEqual(["mock-mini", "mock-large", "mock-coder"])
  })

  it("rejects chat completions without the key", async () => {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "mock-mini", messages: [] }),
    })
    expect(response.status).toBe(401)
  })

  it("names the requested model in the model field and the reply text (non-streaming)", async () => {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: "mock-large", messages: [{ role: "user", content: "hi" }] }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      model: string
      choices: Array<{ message: { content: string }; finish_reason: string }>
    }
    expect(body.model).toBe("mock-large")
    expect(body.choices[0]?.message.content).toBe("MOCK-OK via mock-large")
    expect(body.choices[0]?.finish_reason).toBe("stop")
  })

  it("names the requested model in every stream chunk (streaming)", async () => {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: "mock-coder", messages: [{ role: "user", content: "hi" }], stream: true }),
    })
    expect(response.status).toBe(200)
    const payloads = await readSse(response)
    const content = JSON.parse(payloads[0] ?? "{}") as {
      model: string
      choices: Array<{ delta: { content?: string } }>
    }
    const finish = JSON.parse(payloads[1] ?? "{}") as {
      model: string
      choices: Array<{ delta: Record<string, never>; finish_reason: string }>
    }
    expect(content.model).toBe("mock-coder")
    expect(content.choices[0]?.delta.content).toBe("MOCK-OK via mock-coder")
    expect(finish.model).toBe("mock-coder")
    expect(finish.choices[0]?.finish_reason).toBe("stop")
    expect(payloads[payloads.length - 1]).toBe("[DONE]")
  })

  it("defaults to mock-mini when the request carries no model", async () => {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    })
    const body = (await response.json()) as { model: string }
    expect(body.model).toBe("mock-mini")
  })
})