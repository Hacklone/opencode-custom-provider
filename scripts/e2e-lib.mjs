/**
 * Shared plumbing for the e2e harnesses (scripts/e2e.mjs, scripts/e2e-tui.mjs):
 * throwaway-sandbox construction, a real `opencode serve` with full isolation
 * from the user's environment, and fail-fast assertion helpers.
 */
import { execFile, spawn } from "node:child_process"
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

export { startMockLlmServer as startMock } from "./mock-llm/server.mjs"

export const PASSWORD = "e2e-password"
export const KEY = "sk-mock-1234"
// Verified from @opencode/client: auth is Basic "opencode:<password>".
export const AUTH = "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64")
export const REPO = path.resolve(import.meta.dirname, "..")
export const MODEL_IDS = ["mock-mini", "mock-large", "mock-coder"]

export class StepFailure extends Error {}

let checks = 0
export function check(name, ok, detail = "") {
  checks++
  if (ok) {
    console.log(`  ok  ${name}`)
    return
  }
  throw new StepFailure(`${name}${detail ? ` — ${detail}` : ""}`)
}

export function checkCount() {
  return checks
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Retries `probe` until it returns non-nullish, or fails with a clear message. */
export async function until(desc, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs
  let last = undefined
  while (Date.now() < deadline) {
    try {
      last = await probe()
    } catch {
      last = undefined
    }
    if (last !== undefined && last !== null) return last
    await sleep(250)
  }
  throw new StepFailure(`timed out waiting for ${desc}`)
}

export function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

/** Some list endpoints wrap in {data:[…]}, others return bare arrays. */
export function pickArray(json) {
  if (Array.isArray(json)) return json
  if (Array.isArray(json?.data)) return json.data
  if (Array.isArray(json?.items)) return json.items
  return []
}

export function buildSandbox(prefix = "custom-provider-e2e-") {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), prefix))
  const plugin = path.join(sandbox, ".opencode", "plugins", "custom-provider")
  mkdirSync(plugin, { recursive: true })
  for (const shim of ["index.ts", "tui.tsx", "rpc.ts", "tsconfig.json"]) {
    copyFileSync(path.join(REPO, shim), path.join(plugin, shim))
  }
  // Local .opencode/plugins discovery loads <dir>/index.ts and resolves deps
  // from the plugin's own tree — hence the src copy + node_modules symlink.
  cpSync(path.join(REPO, "src"), path.join(plugin, "src"), { recursive: true })
  symlinkSync(path.join(REPO, "node_modules"), path.join(plugin, "node_modules"), "dir")
  return sandbox
}

export function spawnServe(sandbox, port) {
  const logPath = path.join(sandbox, `serve-${port}.log`)
  const log = openSync(logPath, "a")
  const child = spawn("opencode", ["serve", "--port", String(port)], {
    cwd: sandbox,
    env: {
      ...process.env,
      OPENCODE_PASSWORD: PASSWORD,
      // Isolate the safe store and data dir from the user's real environment.
      OPENCODE_DB: path.join(sandbox, "opencode.db"),
      XDG_DATA_HOME: path.join(sandbox, "xdg"),
    },
    stdio: ["ignore", log, log],
  })
  return { child, port, logPath }
}

export async function stopServe(serve) {
  if (serve?.child !== undefined && serve.child.exitCode === null) {
    serve.child.kill("SIGTERM")
    await Promise.race([new Promise((resolve) => serve.child.once("exit", resolve)), sleep(3000)])
    if (serve.child.exitCode === null) serve.child.kill("SIGKILL")
  }
  // `opencode serve` can detach its real server into a grandchild that
  // outlives the spawned child (observed: orphaned, PPID 1, still holding the
  // listen socket). Kill whatever still holds the port, whatever its tree.
  for (let attempt = 0; attempt < 10; attempt++) {
    const pids = await portPids(serve.port)
    if (pids.length === 0) return
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {}
    }
    await sleep(200)
  }
}

/** PIDs of processes listening on `port`, via lsof (macOS ships it). */
export async function portPids(port) {
  try {
    const { stdout } = await promisify(execFile)("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"])
    return stdout
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

export async function teardown(serve, mocks, sandbox) {
  try {
    await stopServe(serve)
    for (const mock of mocks) {
      try {
        mock?.closeAllConnections?.()
        if (mock !== null) await promisify(mock.close.bind(mock))()
      } catch {}
    }
    // E2E_KEEP=1 keeps the sandbox for post-mortem debugging.
    if (sandbox !== null && process.env.E2E_KEEP !== "1") rmSync(sandbox, { recursive: true, force: true })
  } catch {}
}

/** fetch wrapper against `base`, every request under a hard timeout. */
export function makeApi(base) {
  return async function api(method, requestPath, body) {
    const response = await fetch(`${base}${requestPath}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: AUTH,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json = null
    try {
      json = text.length > 0 ? JSON.parse(text) : null
    } catch {
      // Non-JSON body: callers use `text`.
    }
    return { status: response.status, json, text }
  }
}

/**
 * Waits for the serve to be healthy and the plugin to settle (the rpc status
 * route answering with a providers array). Locally-discovered plugins are
 * intentionally absent from /api/plugin — this poll is the real "plugin
 * loaded" proof.
 */
export async function waitSettled(api) {
  await until("serve /api/info responds", 30_000, async () => {
    const { status } = await api("GET", "/api/info")
    return status === 200 ? true : undefined
  })
  let last = "(no response)"
  try {
    return await until("plugin settles (rpc status)", 30_000, async () => {
      const r = await api("POST", "/api/rpc/custom-provider/status", { input: {} })
      if (r.status >= 400) {
        last = r.text
        return undefined
      }
      const s = r.json?.output ?? r.json
      return Array.isArray(s?.providers) ? s : undefined
    })
  } catch (error) {
    throw new StepFailure(`${error.message} — last rpc response: ${last}`)
  }
}
