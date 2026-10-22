// TUI-level e2e: drives a REAL OpenCode TUI (spawned under a termwright PTY
// daemon) through the /custom-provider dialog flows, asserting UI text via
// wait_for_text and server state via HTTP between steps.
//
// Layout facts (probes tui-probe3..6, 2026-10-22):
// - The CLI must get the sandbox DIR as an explicit argument — otherwise its
//   location discovery falls back to the home directory and the local
//   .opencode/plugins TUI plugin never loads ("No matching commands").
// - The CLI must get --server + OPENCODE_PASSWORD, otherwise service
//   discovery can land on the user's global service (its DB showed through).
// - Dialog navigation uses arrow keys (the action select has no search
//   callback); prompts are cleared with repeated Backspace before typing.
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import {
  KEY, MODEL_IDS, PASSWORD, StepFailure,
  buildSandbox, check, checkCount, freePort, makeApi,
  spawnServe, startMock, teardown, waitSettled,
} from "./e2e-lib.mjs"

const run = promisify(execFile)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let sock = ""

/** One termwright daemon request; returns {result} or throws with the error. */
async function tw(method, params) {
  const { stdout } = await run("termwright", [
    "exec", "--socket", sock, "--method", method, "--params", JSON.stringify(params ?? null),
  ])
  const reply = JSON.parse(stdout)
  if (reply.error) throw new StepFailure(`termwright ${method}: ${reply.error.message}`)
  return reply.result
}

async function screenText() {
  try {
    return await tw("screen", { format: "text" })
  } catch {
    return "(screen unavailable)"
  }
}

/** Press `key` n times (used to clear prefilled prompt values). */
async function pressTimes(key, n) {
  for (let i = 0; i < n; i++) await tw("press", { key })
}

/** Open the provider dialog from the home screen. */
async function openDialog() {
  await tw("type", { text: "/custom-provider" })
  await tw("press", { key: "Enter" })
  await tw("wait_for_text", { text: "Custom providers", timeout_ms: 10_000 })
  await tw("wait_for_idle", { idle_ms: 500, timeout_ms: 10_000 })
}

/** Escape out of any open dialog/prompt and wait for the flow to close. */
async function closeDialog() {
  for (let i = 0; i < 3; i++) {
    await tw("press", { key: "Escape" })
    await sleep(300)
  }
  await tw("wait_for_text_gone", { text: "Custom providers", timeout_ms: 8_000 })
}

async function main() {
  let mock = null
  let serve = null
  let sandbox = null
  let daemon = null
  try {
    mock = await startMock({ port: 0 })
    const mockURL = `http://127.0.0.1:${mock.address().port}/v1`
    sandbox = buildSandbox("custom-provider-e2e-tui-")
    const port = await freePort()
    serve = spawnServe(sandbox, port)
    const api = makeApi(`http://127.0.0.1:${port}`)
    await waitSettled(api)
    const rpc = async (method, input = {}) => {
      const r = await api("POST", `/api/rpc/custom-provider/${method}`, { input })
      if (r.status >= 400) throw new StepFailure(`rpc ${method} → HTTP ${r.status}: ${r.text.slice(0, 300)}`)
      return r.json?.output ?? r.json
    }
    console.log(`serve on :${port} (sandbox ${sandbox})`)

    // Spawn the TUI under a termwright PTY, pinned to the sandbox location
    // and the isolated serve (see header).
    sock = path.join(sandbox, "tw.sock")
    daemon = spawn("termwright", [
      "daemon", "--socket", sock, "--background", "--cols", "120", "--rows", "36", "--",
      "opencode", "--server", `http://127.0.0.1:${port}`, sandbox,
    ], {
      cwd: sandbox,
      env: { ...process.env, OPENCODE_PASSWORD: PASSWORD },
      stdio: "ignore",
    })
    daemon.unref()
    await sleep(3500)
    await tw("handshake")
    await tw("wait_for_idle", { idle_ms: 800, timeout_ms: 30_000 })
    await tw("wait_for_text", { text: "Ask anything", timeout_ms: 30_000 })
    check("TUI booted into the isolated serve", true)

    // --- ADD flow: empty list → Add is the only option ---
    await openDialog()
    await tw("press", { key: "Enter" }) // pick "Add new provider"
    await tw("wait_for_text", { text: "Provider name", timeout_ms: 8_000 })
    await pressTimes("Backspace", 12) // drop the search-prefilled name
    await tw("type", { text: "E2E Prov" })
    await tw("press", { key: "Enter" })
    await tw("wait_for_text", { text: "Base URL", timeout_ms: 8_000 })
    await tw("type", { text: mockURL })
    await tw("press", { key: "Enter" })
    await tw("wait_for_text", { text: "API key", timeout_ms: 8_000 })
    await tw("type", { text: KEY })
    await tw("press", { key: "Enter" })
    await tw("wait_for_text", { text: "Custom provider added", timeout_ms: 10_000 })
    check("TUI add flow reports success", true)

    const status = await rpc("status")
    const saved = status.providers[0]
    check("TUI add saved the provider", saved?.id === "e2e-prov" && saved?.modelCount === MODEL_IDS.length && saved?.hasCredential === true, JSON.stringify(status))
    const providerSnap = (await api("GET", "/api/provider")).json
    check("TUI add registered the provider server-side", JSON.stringify(providerSnap).includes('"e2e-prov"'))
    const integration = (await api("GET", "/api/integration")).json
    check("TUI add registered the integration for /connect", JSON.stringify(integration).includes('"e2e-prov"'))
    const credential = (await api("GET", "/api/credential")).json
    check("TUI add saved an active credential", JSON.stringify(credential).includes('"e2e-prov"') && JSON.stringify(credential).includes('"active":true'))
    const defaultModel = (await api("GET", "/api/model/default")).json
    check("TUI add set the catalog default", defaultModel?.data?.id === MODEL_IDS[0], JSON.stringify(defaultModel))

    // --- EDIT flow: rename via the action dialog (Edit is the first action) ---
    await closeDialog()
    await openDialog()
    await tw("press", { key: "Enter" }) // pick the provider (first option)
    await tw("wait_for_text", { text: "(e2e-prov)", timeout_ms: 8_000 })
    await tw("press", { key: "Enter" }) // Edit
    await tw("wait_for_text", { text: "Provider name", timeout_ms: 8_000 })
    await pressTimes("Backspace", 16) // clear the prefilled name
    await tw("type", { text: "E2E Prov 2" })
    await tw("press", { key: "Enter" })
    await tw("wait_for_text", { text: "Base URL", timeout_ms: 8_000 })
    await tw("press", { key: "Enter" }) // keep the prefilled base URL
    await tw("wait_for_text", { text: "Custom provider updated", timeout_ms: 10_000 })
    check("TUI edit flow reports success", true)
    const renamed = await rpc("status")
    check("TUI edit renamed the provider", renamed.providers[0]?.name === "E2E Prov 2" && renamed.providers[0]?.modelCount === MODEL_IDS.length, JSON.stringify(renamed))

    // --- NO-OP edit guard: submitting unchanged values changes nothing ---
    await closeDialog()
    await openDialog()
    await tw("press", { key: "Enter" })
    await tw("wait_for_text", { text: "(e2e-prov)", timeout_ms: 8_000 })
    await tw("press", { key: "Enter" }) // Edit
    await tw("wait_for_text", { text: "Provider name", timeout_ms: 8_000 })
    await tw("press", { key: "Enter" }) // unchanged name
    await tw("wait_for_text", { text: "Base URL", timeout_ms: 8_000 })
    await tw("press", { key: "Enter" }) // unchanged base URL
    await tw("wait_for_text", { text: "Nothing to change", timeout_ms: 10_000 })
    check("TUI no-op edit says so instead of calling the server", true)

    // --- REFRESH flow: second action ---
    await closeDialog()
    await openDialog()
    await tw("press", { key: "Enter" })
    await tw("wait_for_text", { text: "(e2e-prov)", timeout_ms: 8_000 })
    await tw("press", { key: "Down" })
    await tw("press", { key: "Enter" }) // Refresh
    await tw("wait_for_text", { text: "Inventory refreshed", timeout_ms: 15_000 })
    check("TUI refresh flow reports success", true)
    const refreshed = await rpc("status")
    check("TUI refresh kept the inventory", refreshed.providers[0]?.modelCount === MODEL_IDS.length)

    // --- REMOVE flow: third action, confirm dialog, leftover note ---
    await closeDialog()
    await openDialog()
    await tw("press", { key: "Enter" })
    await tw("wait_for_text", { text: "(e2e-prov)", timeout_ms: 8_000 })
    await tw("press", { key: "Down" })
    await tw("press", { key: "Down" })
    await tw("press", { key: "Enter" }) // Remove
    await tw("wait_for_text", { text: "Remove E2E Prov 2?", timeout_ms: 8_000 })
    check("TUI remove asks for confirmation", true)
    await tw("press", { key: "Enter" }) // confirm
    await tw("wait_for_text", { text: "Custom provider removed", timeout_ms: 10_000 })
    await tw("wait_for_text", { text: "remains in the safe store", timeout_ms: 5_000 })
    check("TUI remove reports the leftover credential", true)
    const after = await rpc("status")
    check("TUI remove unregistered the provider", after.providers.length === 0, JSON.stringify(after))
    const keptIntegration = (await api("GET", "/api/integration")).json
    check("removed provider's integration stays for /connect cleanup", JSON.stringify(keptIntegration).includes('"e2e-prov"'))
    const keptCredential = (await api("GET", "/api/credential")).json
    check("removed provider's safe-store credential remains", JSON.stringify(keptCredential).includes('"e2e-prov"'))

    console.log(`E2E-TUI PASSED (${checkCount()} checks)`)
  } catch (error) {
    console.error(`E2E-TUI FAILED: ${error.message}`)
    console.error(`---- last screen ----\n${await screenText()}\n---- /last screen ----`)
    process.exitCode = 1
  } finally {
    if (sock !== "") {
      try { await tw("close") } catch {}
    }
    await teardown(serve, [mock], sandbox)
  }
}

await main()
process.exit(process.exitCode ?? 0)