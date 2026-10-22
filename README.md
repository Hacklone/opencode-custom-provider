# @coool/opencode-custom-provider

Connect any OpenAI-compatible API to OpenCode — no config files, no env vars.
API keys go into OpenCode's built-in secret store; the models show up in the
TUI's `/models` picker like any built-in provider.

## Install

```sh
opencode plugin add @coool/opencode-custom-provider
```

## Usage

In the TUI, run `/custom-provider`, pick "Add new provider", and answer three
prompts: name, base URL, API key (empty = endpoint needs no key). The plugin
calls `/v1/models` on your endpoint and registers what it finds — from then
on, pick your models in the built-in `/models` dialog like any other provider.

In the web UI and other clients, the same flows exist as commands:

```
/web-custom-provider                                                   → list
/web-custom-provider add id=<id> name=<Name> base=<url> [key=<key>]
/web-custom-provider edit id=<id> [name=<Name>] [base=<url>]
/web-custom-provider remove id=<id>
```

Values with spaces need double quotes. The `id` can't be changed later. A bad
URL or wrong key aborts `add` with the endpoint's error — nothing gets saved.

Rotate keys with the built-in `/connect` — your custom provider appears there
like a native one.

## Good to know

- The model inventory is fetched only when you add, edit the base URL, or
  refresh — the plugin never polls your endpoint. If a refresh fails, the
  last-known inventory stays and the provider is flagged in the list until it
  recovers.
- Removing a provider keeps its key in the secret store (the plugin API can't
  delete credentials). The `/connect` entry stays so you can delete the
  account there; the plugin reminds you when it happens.
- Models are registered with OpenCode's default assumptions: tools, text and
  image input, 200k context, 32k output. No per-model configuration in v1.

## Development

```sh
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest with a 100% coverage gate
npm run e2e          # server API, driven against a real opencode serve
npm run e2e:tui      # the TUI dialogs, driven via termwright
```

Both e2e layers spawn real OpenCode processes against an in-process mock
endpoint, inside a throwaway sandbox — your installation is never touched.

## License

MIT