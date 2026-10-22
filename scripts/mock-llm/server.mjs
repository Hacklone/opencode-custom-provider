// Minimal OpenAI-compatible mock server for manual and automated plugin testing.
// GET  /v1/models            — auth-enforced model inventory
// POST /v1/chat/completions  — auth-enforced echo that names the serving model
//                              in both the `model` field and the reply text, so a
//                              chat round-trip visibly proves which model ran.
// Run directly: node scripts/mock-llm/server.mjs (PORT env overrides 8991).
import http from "node:http"
import { pathToFileURL } from "node:url"

const KEY = "sk-mock-1234"
const models = { data: [{ id: "mock-mini" }, { id: "mock-large" }, { id: "mock-coder" }] }

function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://x")
  if (req.method === "GET" && url.pathname === "/v1/models") {
    if (req.headers.authorization !== `Bearer ${KEY}`) return unauthorized(res)
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(models))
    return
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    if (req.headers.authorization !== `Bearer ${KEY}`) return unauthorized(res)
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}")
      const model = parsed.model ?? "mock-mini"
      const text = `MOCK-OK via ${model}`
      if (parsed.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" })
        const chunk = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
        chunk({ id: "cmpl-mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", content: text } }] })
        chunk({ id: "cmpl-mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })
        res.write("data: [DONE]\n\n")
        res.end()
        return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          id: "cmpl-mock",
          object: "chat.completion",
          model,
          choices: [
            { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 4, total_tokens: 5 },
        }),
      )
    })
    return
  }
  res.writeHead(404)
  res.end()
}

function unauthorized(res) {
  res.writeHead(401, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: { message: "bad key" } }))
}

/** Starts the mock on `port` (0 = ephemeral) and resolves with the listening server. */
export function startMockLlmServer({ port = 8991 } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer(handle)
    server.listen(port, () => resolve(server))
  })
}

const invoked = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) startMockLlmServer({ port: Number(process.env.PORT ?? 8991) }).then(() => console.log("mock LLM on :" + (process.env.PORT ?? 8991)))