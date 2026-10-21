import { ProviderInputError } from "../domain/provider-types.ts"

/**
 * Server command grammar (pure, no platform imports). TUI dialogs build the
 * same inputs directly; the grammar is for the `custom-connect` /
 * `custom-models` server commands driven from the web UI.
 *
 * /custom-connect                          → status list
 * /custom-connect add id=<id> name=<Name> base=<url> [key=<key>]
 * /custom-connect edit id=<id> [name=<Name>] [base=<url>] [key=<key>]
 * /custom-connect remove id=<id>
 * /custom-models                           → list providers
 * /custom-models <id>                      → refresh + list models
 * /custom-models <id> default <modelID>    → catalog default + session switch
 */

export type ConnectAction =
  | { kind: "status" }
  | { kind: "add"; id?: string; name: string; baseURL: string; key?: string }
  | { kind: "edit"; id: string; name?: string; baseURL?: string; key?: string | null }
  | { kind: "remove"; id: string }

export type ModelsAction =
  | { kind: "list" }
  | { kind: "show"; id: string }
  | { kind: "setDefault"; id: string; modelID: string }

export function parseConnectArgs(text: string): ConnectAction {
  const tokens = tokenize(text)
  if (tokens.length === 0) return { kind: "status" }
  const [action, ...rest] = tokens
  if (action === "add") {
    const args = parseKeyValues(rest, ["id", "name", "base", "key"])
    const name = args["name"]
    const baseURL = args["base"]
    if (name === undefined || baseURL === undefined) {
      throw usageError("add requires name=<Name> and base=<url>")
    }
    const input = { kind: "add" as const, name, baseURL }
    const id = args["id"]
    const key = args["key"]
    if (id !== undefined) (input as { id?: string }).id = id
    if (key !== undefined) (input as { key?: string }).key = key
    return input
  }
  if (action === "edit") {
    const args = parseKeyValues(rest, ["id", "name", "base", "key"])
    const id = args["id"]
    if (id === undefined) throw usageError("edit requires id=<id>")
    const patch: { kind: "edit"; id: string; name?: string; baseURL?: string; key?: string | null } = { kind: "edit", id }
    if (args["name"] !== undefined) patch.name = args["name"]
    if (args["base"] !== undefined) patch.baseURL = args["base"]
    if (args["key"] !== undefined) patch.key = args["key"]
    return patch
  }
  if (action === "remove") {
    const args = parseKeyValues(rest, ["id"])
    const id = args["id"]
    if (id === undefined) throw usageError("remove requires id=<id>")
    return { kind: "remove", id }
  }
  throw usageError(`unknown action "${action}"`)
}

export function parseModelsArgs(text: string): ModelsAction {
  const tokens = tokenize(text)
  if (tokens.length === 0) return { kind: "list" }
  const [first, action, modelID, ...extra] = tokens
  // Invariant: tokens.length > 0 above, so the first token exists.
  const id = first!
  if (action === undefined) return { kind: "show", id }
  if (action === "default") {
    if (modelID === undefined || extra.length > 0) {
      throw usageError(`default requires a model id: /custom-models ${id} default <modelID>`)
    }
    return { kind: "setDefault", id, modelID }
  }
  throw usageError(`unknown action "${action}"`)
}

function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const token of text.trim().split(/\s+/)) {
    if (token.length > 0) tokens.push(token)
  }
  return tokens
}

function parseKeyValues(tokens: readonly string[], allowed: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (const token of tokens) {
    const eq = token.indexOf("=")
    if (eq <= 0) throw usageError(`argument "${token}" must be key=<value>`)
    const key = token.slice(0, eq)
    if (!allowed.includes(key)) throw usageError(`unknown argument "${key}" — expected one of: ${allowed.join(", ")}`)
    args[key] = token.slice(eq + 1)
  }
  return args
}

function usageError(detail: string): ProviderInputError {
  return new ProviderInputError(
    `${detail} — usage: /custom-connect [add id=<id> name=<Name> base=<url> [key=<key>]] | [edit id=<id> [name=<Name>] [base=<url>] [key=<key>]] | [remove id=<id>]`,
  )
}

export function formatStatus(providers: { id: string; name: string; baseURL: string; modelCount: number; hasCredential: boolean }[]): string {
  if (providers.length === 0) {
    return "Custom providers: none — add one with /custom-connect add id=<id> name=<Name> base=<url> [key=<key>]"
  }
  const lines = providers.map((p) => {
    const credential = p.hasCredential ? "credential saved" : "keyless"
    return `- ${p.id} (${p.name}) → ${p.baseURL} · ${p.modelCount} models · ${credential}`
  })
  return `Custom providers:\n${lines.join("\n")}`
}

export function formatModels(id: string, models: readonly string[]): string {
  const lines = models.map((m) => `- ${id}/${m}`)
  return `Models for ${id}:\n${lines.join("\n")}`
}