# @coool/opencode-custom-provider

An [OpenCode](https://opencode.ai) plugin that registers your own
OpenAI-compatible endpoints as providers — no config files, everything from
the TUI or the web UI.

```
❯ /web-custom-connect add id=llama name="My LlamaBox" base=http://127.0.0.1:8080/v1
  ✓ llama registered — 4 models loaded from /v1/models
❯ /models        # llama/* now appears in the picker
```

## What you get

- **`/custom-connect`** — guided dialogs in the TUI (in the web UI:
  `/web-custom-connect`, see below). Add, edit, remove, and list custom
  providers.
- **Safe-store credentials** — API keys are saved through OpenCode's
  integration API, so they show up in `/connect` and `opencode auth list`
  alongside every other provider. Rotating or re-entering a key is done in the
  built-in `/connect` dialog — it takes effect immediately (verified: OpenCode
  resolves the integration credential at request time). Keyless endpoints
  (local inference servers) work too — just leave the key empty.
- **Automatic inventory** — on connect (and on a base-URL edit, or an explicit
  refresh) the plugin calls `GET {baseURL}/v1/models` and publishes each
  discovered model under `<providerID>/<modelID>`. The fetch is also your
  validation: a bad URL or wrong key aborts the save with the endpoint's error.
- **Model selection is OpenCode's job** — discovered models appear in the
  built-in `/models` picker (verified). Adding a provider automatically makes
  its first model the catalog default; switch or change it with `/models`
  like any other model.
- **Offline-tolerant restore** — providers are restored from plugin storage at
  startup with zero network calls; the last-known inventory stays visible
  until a refresh succeeds.

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

- `/custom-connect` — lists your custom providers directly (pick one to edit,
  refresh the inventory, or remove, or choose **Add new provider**), then
  answers the prompts; empty key = keyless.
- `/models`, `/connect` — the built-in dialogs handle model selection and API
  key rotation for custom providers, exactly as for built-in ones.

### Web UI / server commands

The server command name differs from the TUI slash name on purpose — a
same-named pair appears twice in the TUI palette (verified empirically).

```
/web-custom-connect                                        → status list
/web-custom-connect add id=<id> name=<Name> base=<url> [key=<key>]
/web-custom-connect edit id=<id> [name=<Name>] [base=<url>]
/web-custom-connect remove id=<id>
```

Values containing spaces must be double-quoted: `name="My Provider"`.

Provider IDs are slugged and must be unique; the ID is immutable after
creation. Editing the base URL re-fetches the inventory immediately. A failed
re-fetch keeps the stored inventory and reports the error — the provider never
disappears because an endpoint hiccuped. The failure is also recorded as the
provider's health and shown in every provider list
(`LAST REFRESH FAILED: <reason>`) until a refresh succeeds.

### Example

```
/web-custom-connect add id=openrouter name=OpenRouter base=https://openrouter.ai/api/v1 key=sk-or-...
/models        # openrouter/* appears in the built-in picker, first model is the default
```

## How credentials work

Keys are written to OpenCode's safe store via the integration API
(`ctx.integration.connect.key`) and mirrored into plugin storage as a
fallback. Resolution prefers the integration connection, then the mirror.
Verified live: OpenCode resolves the integration credential at **request
time** via `Provider.Info.integrationID`, and an active integration
credential wins over the `settings.apiKey` embedded at registration — so a
key rotated in `/connect` takes effect immediately without re-registering.
Status output only ever shows booleans — key material never appears in logs
or messages. See `docs/adr/0001-credentials-in-safe-store.md` for the
trade-offs.

Inventory is fetched **only on demand** (connect, base-URL edit, refresh) —
the plugin never polls your endpoints in the background.

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