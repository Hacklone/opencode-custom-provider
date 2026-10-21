# @coool/opencode-custom-provider

An [OpenCode](https://opencode.ai) plugin that registers your own
OpenAI-compatible endpoints as providers — no config files, everything from
the TUI or the web UI.

```
❯ /custom-provider-connect add id=llama name="My LlamaBox" base=http://127.0.0.1:8080/v1
  ✓ llama registered — 4 models loaded from /v1/models
❯ /models        # llama/* now appears in the picker
```

## What you get

- **`/custom-connect`** — guided dialogs in the TUI (in the web UI:
  `/custom-provider-connect`, see below). Add, edit, remove, and list custom
  providers.
- **Safe-store credentials** — API keys are saved through OpenCode's
  integration API, so they show up in `/connect` and `opencode auth list`
  alongside every other provider. Keyless endpoints (local inference servers)
  work too — just leave the key empty.
- **Automatic inventory** — on connect (and on edit, or an explicit refresh)
  the plugin calls `GET {baseURL}/v1/models` and publishes each discovered
  model under `<providerID>/<modelID>`. The fetch is also your validation: a
  bad URL or wrong key aborts the save with the endpoint's error.
- **Offline-tolerant restore** — providers are restored from plugin storage at
  startup with zero network calls; the last-known inventory stays visible
  until a refresh succeeds.
- **Model selection** — `/custom-models` refreshes a provider's inventory and
  lets you pick a model for the current session or make it the catalog
  default.

Discovered models use OpenCode's uncatalogued-model fallbacks: tool support,
text + image input, text output, 200k context, 32k output. No per-model
overrides in v1.

## Install

```sh
opencode plugin add @coool/opencode-custom-provider
```

Or link this directory into `.opencode/plugins/custom-provider/` in your
project (local discovery loads `<dir>/index.ts` directly).

## Usage

### TUI (dialogs)

- `/custom-connect` — lists your custom providers directly (pick one to edit
  or remove, or choose **Add new provider**), then answers the prompts; empty
  key = keyless.
- `/custom-models` — pick a provider, the inventory refreshes, pick a model,
  then **Use in this session** or **Make default**.

### Web UI / server commands

The server command names differ from the TUI slash names on purpose — a
same-named pair appears twice in the TUI palette (verified empirically).

```
/custom-provider-connect                                        → status list
/custom-provider-connect add id=<id> name=<Name> base=<url> [key=<key>]
/custom-provider-connect edit id=<id> [name=<Name>] [base=<url>] [key=<key>]
/custom-provider-connect remove id=<id>
/custom-provider-models                                         → list providers
/custom-provider-models <id>                                    → refresh + list models
/custom-provider-models <id> default <modelID>                  → catalog default + switch session
```

Values containing spaces must be double-quoted: `name="My Provider"`.

Provider IDs are slugged and must be unique; the ID is immutable after
creation. Editing the base URL or key re-fetches the inventory immediately. A
failed re-fetch keeps the stored inventory and reports the error — the
provider never disappears because an endpoint hiccuped.

### Example

```
/custom-provider-connect add id=openrouter name=OpenRouter base=https://openrouter.ai/api/v1 key=sk-or-...
/custom-provider-models openrouter
/custom-provider-models openrouter default anthropic/claude-sonnet-4.5
```

## How credentials work

Keys are written to OpenCode's safe store via the integration API
(`ctx.integration.connect.key`) and mirrored into plugin storage as a
fallback. Resolution prefers the integration connection, then the mirror.
Status output only ever shows booleans — key material never appears in logs
or messages. See `docs/adr/0001-credentials-in-safe-store.md` for the
trade-offs.

Inventory is fetched **only on demand** (connect, edit, refresh) — the plugin
never polls your endpoints in the background.

## Development

```sh
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest with a 100% coverage gate
```

Architecture and conventions live in `AGENTS.md`; domain vocabulary in
`GLOSSARY.md`. Conventions are cloned from
[`@coool/opencode-decision-mode`](https://github.com/coool/opencode-decision-mode).

## License

MIT