#!/usr/bin/env node
/**
 * Server-level end-to-end test: boots the OpenAI-compatible mock LLM
 * in-process, builds a throwaway sandbox project with the plugin linked in,
 * spawns a real `opencode serve`, and drives the full plugin lifecycle over
 * the server's HTTP API with hard assertions (fail fast on the first one).
 *
 * Run: npm run e2e   (requires the `opencode` CLI on PATH)
 *
 * Isolation: the serve gets its own OPENCODE_DB and XDG_DATA_HOME inside the
 * sandbox, so the harness never touches your real safe store or service.
 */
import { promisify } from "node:util"
import { startMockLlmServer } from "./mock-llm/server.mjs"
import {
  AUTH, KEY, MODEL_IDS, StepFailure, buildSandbox, check, checkCount, freePort,
  makeApi, pickArray, spawnServe, startMock, stopServe, teardown, until, waitSettled,
} from "./e2e-lib.mjs"

async function main() {
  let mock1 = null
  let mock2 = null
  let serve = null
  let sandbox = null
  try {
    mock1 = await startMock({ port: 0 })
    const v1 = (port) => `http://127.0.0.1:${port}/v1`
    const mockPort1 = mock1.address().port

    sandbox = buildSandbox()
    const port = await freePort()
    serve = spawnServe(sandbox, port)
    const api = makeApi(`http://127.0.0.1:${port}`)

    // A missing input must serialize as {} — the server rejects a bare body
    // ("expected object, received undefined") and JSON drops undefined keys.
    const rpc = async (method, input = {}) => {
      const { status, json, text } = await api("POST", `/api/rpc/custom-provider/${method}`, { input })
      if (status >= 400) throw new StepFailure(`rpc ${method} → HTTP ${status}: ${text.slice(0, 300)}`)
      return json?.output ?? json
    }

    // --- Boot: serve healthy, plugin loaded, registry settled.
    const settled = await waitSettled(api)
    console.log(`serve on :${port} (sandbox ${sandbox})`)
    check("no providers before any connect", settled.providers.length === 0)

    // --- Connect: registration, safe-store credential, /connect visibility.
    const connected = await rpc("connect", { name: "Mock", baseURL: v1(mockPort1), key: KEY })
    check("connect returns the slugified id", connected.id === "mock", JSON.stringify(connected))
    check("connect fetched the inventory", connected.modelCount === MODEL_IDS.length)
    check("connect saved the credential", connected.hasCredential === true)

    const providers = pickArray((await api("GET", "/api/provider")).json)
    const registered = providers.find((p) => p?.id === "mock")
    check("provider is in /api/provider", registered !== undefined)
    check("provider points at the endpoint", JSON.stringify(registered).includes(v1(mockPort1)))

    const models = pickArray((await api("GET", "/api/model")).json)
    for (const id of MODEL_IDS) {
      check(`model ${id} is in /api/model`, models.some((m) => m?.id === id && m?.providerID === "mock"))
    }

    const integrations = pickArray((await api("GET", "/api/integration")).json)
    check("integration is in /api/integration (for /connect)", integrations.some((i) => i?.id === "mock"))

    const credentials = pickArray((await api("GET", "/api/credential")).json)
    check(
      "an active credential exists in the safe store",
      credentials.some((c) => c?.integrationID === "mock" && c?.active === true),
    )

    // --- Auto-default: the first discovered model becomes the catalog default.
    const defaultBody = (await api("GET", "/api/model/default")).json
    const modelDefault = defaultBody?.data ?? defaultBody
    check(
      "adding the provider set the catalog default",
      modelDefault?.providerID === "mock" && modelDefault?.id === MODEL_IDS[0],
      JSON.stringify(modelDefault),
    )

    // --- REAL chat round-trip through the registered provider.
    const created = await api("POST", "/api/session", {})
    const sessionID = created.json?.id ?? created.json?.data?.id
    check("session created", typeof sessionID === "string" && sessionID.length > 0, created.text.slice(0, 200))
    await api("POST", `/api/session/${sessionID}/model`, { model: { providerID: "mock", id: "mock-large" } })
    const prompt = await api("POST", `/api/session/${sessionID}/prompt`, { text: "Say hi" })
    try {
      await until("assistant reply names the serving model", 60_000, async () => {
        const { json } = await api("GET", `/api/session/${sessionID}/message`)
        return JSON.stringify(json ?? "").includes(`MOCK-OK via mock-large`) ? true : undefined
      })
    } catch (error) {
      throw new StepFailure(`${error.message}; prompt response: ${prompt.text.slice(0, 300)}`)
    }

    // --- Base-URL edit refetches from the NEW endpoint (the old one is dead).
    mock1.closeAllConnections?.()
    await promisify(mock1.close.bind(mock1))()
    mock1 = null
    mock2 = await startMock({ port: 0 })
    const mockPort2 = mock2.address().port
    const edited = await rpc("edit", { id: "mock", baseURL: v1(mockPort2) })
    check("baseURL edit refetched the inventory", edited.modelCount === MODEL_IDS.length, JSON.stringify(edited))
    check("baseURL edit stored the new URL", edited.baseURL === v1(mockPort2))

    // --- Validate-before-save: a wrong key aborts the save, nothing stored.
    const rejected = await api("POST", "/api/rpc/custom-provider/connect", {
      input: { name: "Evil", baseURL: v1(mockPort2), key: "sk-wrong" },
    })
    check(
      "wrong-key connect is rejected with a real message",
      rejected.status === 400 && rejected.text.includes("provider_error") && /401|API key/i.test(rejected.text),
      rejected.text.slice(0, 200),
    )
    const afterReject = await rpc("status")
    check("rejected connect saved nothing", afterReject.providers.length === 1 && afterReject.providers[0]?.id === "mock")

    // --- Explicit refresh.
    const refreshed = await rpc("refresh", { id: "mock" })
    check("refresh returns the inventory", JSON.stringify(refreshed.models) === JSON.stringify(MODEL_IDS))

    // --- Remove: provider gone, integration KEPT (account stays manageable).
    const removal = await rpc("remove", { id: "mock" })
    check("remove reports the leftover credential", removal.hadCredential === true)
    const providersAfter = pickArray((await api("GET", "/api/provider")).json)
    check("provider is unregistered", !providersAfter.some((p) => p?.id === "mock"))
    const integrationsAfter = pickArray((await api("GET", "/api/integration")).json)
    check("integration stays registered for /connect cleanup", integrationsAfter.some((i) => i?.id === "mock"))
    const credentialsAfter = pickArray((await api("GET", "/api/credential")).json)
    check("safe-store credential remains after remove", credentialsAfter.some((c) => c?.integrationID === "mock"))

    // --- Offline restore: re-add, cold-restart the serve, state comes back.
    await rpc("connect", { name: "Mock", baseURL: v1(mockPort2), key: KEY })
    await stopServe(serve)
    serve = null
    const restartPort = await freePort()
    serve = spawnServe(sandbox, restartPort)
    const restartApi = makeApi(`http://127.0.0.1:${restartPort}`)
    const restartRpc = async (method, input = {}) => {
      const { status, json, text } = await restartApi("POST", `/api/rpc/custom-provider/${method}`, { input })
      if (status >= 400) throw new StepFailure(`rpc ${method} → HTTP ${status}: ${text.slice(0, 300)}`)
      return json?.output ?? json
    }
    await until("restarted serve responds", 30_000, async () => {
      const { status } = await restartApi("GET", "/api/info")
      return status === 200 ? true : undefined
    })
    const restored = await until("provider restored after cold restart", 30_000, async () => {
      const s = await restartRpc("status")
      const provider = s?.providers?.[0]
      return provider?.id === "mock" ? provider : undefined
    })
    check("restored provider kept its inventory", restored.modelCount === MODEL_IDS.length)
    check("restored provider kept its credential", restored.hasCredential === true)
    const integrationsRestored = pickArray((await restartApi("GET", "/api/integration")).json)
    check("restored provider re-registered its integration", integrationsRestored.some((i) => i?.id === "mock"))

  } finally {
    await teardown(serve, [mock1, mock2], sandbox)
  }
  // Teardown has completed; lingering handles (undici keep-alive sockets to
  // the serve) would otherwise keep node alive. Exit explicitly — and note
  // the PASS print must come AFTER the finally above: process.exit inside
  // the try would skip teardown entirely (verified: the serve survived).
  console.log(`\nE2E PASSED (${checkCount()} checks)`)
  process.exit(0)
}

main().catch((error) => {
  console.error(`\nE2E FAILED: ${error.message}`)
  // The finally in main has already run at this point; exit hard so the
  // same lingering handles cannot keep a failed run alive.
  process.exit(1)
})
