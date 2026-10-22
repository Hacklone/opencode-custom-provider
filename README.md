# @coool/opencode-custom-provider

Point OpenCode at your own OpenAI-compatible endpoint — a llama.cpp server,
vLLM, LiteLLM, an internal gateway — and its models show up in the `/models`
picker like any built-in provider.

Config-file routes exist: `opencode.json` supports custom providers. But that
means hand-editing JSON, managing the API key yourself, and restarting when
you change something. This plugin does it from inside OpenCode, in either
interface, and stores the key in OpenCode's safe store where keys belong.

It works like this: you give the plugin a base URL. It calls `GET /v1/models`
on that endpoint, publishes every model it finds, and keeps the URL. No config
files are written; the registration lives in memory and is rebuilt on startup
from plugin storage — so it survives restarts without ever touching your
`opencode.json`.

```
$ /web-custom-provider add id=llama name="My LlamaBox" base=http://127.0.0.1:8080/v1

Custom providers:
- llama (My LlamaBox) → http://127.0.0.1:8080/v1 · 4 models · credential saved
```

From here on, `llama/<model>` behaves exactly like `anthropic/<model>`: pick it
in `/models`, make it the default, chat with it.

## Install

```sh
opencode plugin add @coool/opencode-custom-provider
```

To run it from a local checkout instead: clone this repo, `npm install` inside
it, then link the checkout into your project:

```sh
ln -s /path/to/opencode-custom-provider .opencode/plugins/custom-provider
```

(The symlink layout matters — OpenCode loads `<dir>/index.ts` directly from
`.opencode/plugins/`, and the plugin resolves its dependencies from its own
`node_modules`.)

## Usage

**In the TUI**, run `/custom-provider`. A dialog lists your providers; pick
"Add new provider" and answer three prompts — name, base URL, API key. Leave
the key empty for endpoints that don't need one. Picking an existing provider
offers Edit, Refresh (re-fetch the inventory), and Remove.

**In the web UI**, or any client that submits commands, use
`/web-custom-provider`:

```
/web-custom-provider                                                   → list
/web-custom-provider add id=<id> name=<Name> base=<url> [key=<key>]
/web-custom-provider edit id=<id> [name=<Name>] [base=<url>]
/web-custom-provider remove id=<id>
```

Values with spaces need double quotes: `name="My Provider"`. The `id` is
slugged and must be unique; it can't be changed later. Editing the base URL
re-fetches the inventory right away. The add command is where a wrong key or
unreachable URL gets caught: the save is aborted with the endpoint's error and
nothing is stored.

The web command has a different name than the TUI slash command on purpose —
OpenCode shows both in the palette when the names collide, so one of them has
to give.

## Model selection and keys are not this plugin's job

Discovered models appear in the built-in `/models` picker, and the first model
of a newly added provider becomes the default until you change it. Keys are
saved through OpenCode's integration API, so your custom provider shows up in
`/connect` and `opencode auth list` like every native provider — including key
rotation, which takes effect on the next request without re-registering
anything.

Two things to know:

- The plugin never talks to your endpoint in the background. The inventory is
  fetched when you add a provider, change its base URL, or ask for a refresh.
  If a refresh or re-fetch fails, the stored inventory stays and the failure
  is flagged in every provider list until the next successful refresh.
- Removing a provider cannot remove its key: the plugin API can write
  credentials but not delete them. The provider's `/connect` entry stays so
  you can delete the account there (or with `opencode auth logout <id>`); the
  plugin tells you this when you remove a provider that had a key.

Discovered models get OpenCode's default assumptions for uncatalogued models:
tools supported, text and image input, text output, 200k context, 32k output.
There is no per-model configuration in v1.

## Development

```sh
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest with a 100% coverage gate
npm run e2e          # server API, driven against a real opencode serve
npm run e2e:tui      # the TUI dialogs, driven via termwright
```

Both e2e layers boot a mock OpenAI-compatible endpoint in-process, build a
throwaway sandbox with its own isolated database, spawn a real OpenCode
process, and assert behavior end to end — including a real chat round-trip
and a restart with the endpoint offline. Your OpenCode installation is never
touched. `scripts/mock-llm/server.mjs` can also be run standalone
(`http://127.0.0.1:8991/v1`, key `sk-mock-1234`) if you want a harmless
endpoint to try the plugin against.

Architecture and conventions live in `AGENTS.md`. This plugin follows the same
structure as [`@coool/opencode-decision-mode`](https://github.com/coool/opencode-decision-mode).

## License

MIT
