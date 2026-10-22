import { ProviderInputError } from "../domain/provider-types.ts"

/**
 * Server command grammar (pure, no platform imports). TUI dialogs build the
 * same inputs directly; the grammar is for the `web-custom-connect` server
 * command driven from the web UI. Model selection is served by OpenCode's
 * built-in /models picker (custom models appear there), so there is no
 * models grammar.
 *
 * /custom-connect          → status list
 * /custom-connect add id=<id> name=<Name> base=<url> [key=<key>]
 * /custom-connect edit id=<id> [name=<Name>] [base=<url>]
 * /custom-connect remove id=<id>
 *
 * Values containing spaces must be double-quoted: name="My Provider".
 */

export type ConnectAction =
  | { kind: "status" }
  | { kind: "add"; id?: string; name: string; baseURL: string; key?: string }
  | { kind: "edit"; id: string; name?: string; baseURL?: string }
  | { kind: "remove"; id: string }

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
    const id = args["id"]
    const key = args["key"]
    return {
      kind: "add",
      name,
      baseURL,
      ...(id !== undefined ? { id } : {}),
      ...(key !== undefined ? { key } : {}),
    }
  }
  if (action === "edit") {
    const args = parseKeyValues(rest, ["id", "name", "base"])
    const id = args["id"]
    if (id === undefined) throw usageError("edit requires id=<id>")
    const patch: { kind: "edit"; id: string; name?: string; baseURL?: string } = { kind: "edit", id }
    if (args["name"] !== undefined) patch.name = args["name"]
    if (args["base"] !== undefined) patch.baseURL = args["base"]
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

/**
 * Whitespace tokenizer that keeps double-quoted spans as one token, so
 * `name="My Provider"` survives splitting. Quote characters are dropped; an
 * unterminated quote extends to the end of the input.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quoted = false
  for (const char of text.trim()) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && /\s/.test(char)) {
      if (current.length > 0) tokens.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current.length > 0) tokens.push(current)
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
    `${detail} — usage: /custom-connect [add id=<id> name=<Name> base=<url> [key=<key>]] | [edit id=<id> [name=<Name>] [base=<url>]] | [remove id=<id>]`,
  )
}

export function formatStatus(providers: {
  id: string
  name: string
  baseURL: string
  modelCount: number
  hasCredential: boolean
  lastError?: string
}[]): string {
  if (providers.length === 0) {
    return "Custom providers: none — add one with /web-custom-connect add id=<id> name=<Name> base=<url> [key=<key>]"
  }
  const lines = providers.map((p) => {
    const credential = p.hasCredential ? "credential saved" : "keyless"
    const health = p.lastError === undefined ? "" : ` · LAST REFRESH FAILED: ${p.lastError}`
    return `- ${p.id} (${p.name}) → ${p.baseURL} · ${p.modelCount} models · ${credential}${health}`
  })
  return `Custom providers:\n${lines.join("\n")}`
}