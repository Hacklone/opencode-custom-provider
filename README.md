# @coool/opencode-custom-provider

Connect any OpenAI-compatible API to OpenCode — no config files, no env vars.
API keys go into OpenCode's built-in secret store; the models show up in the
TUI's `/models` picker like any built-in provider.

```
$ /web-custom-provider add id=llama name="My LlamaBox" base=http://127.0.0.1:8080/v1

Custom providers:
- llama (My LlamaBox) → http://127.0.0.1:8080/v1 · 4 models · credential saved
```

## Install

```sh
opencode plugin add @coool/opencode-custom-provider
```

## Usage

Run `/custom-provider` in the TUI. "Add new provider" asks for a name, a base
URL, and an API key (empty = endpoint needs no key). Picking an existing
provider offers Edit, Refresh, and Remove.

In the web UI and other clients, use the same flows as commands:

```
/web-custom-provider                                                   → list
/web-custom-provider add id=<id> name=<Name> base=<url> [key=<key>]
/web-custom-provider edit id=<id> [name=<Name>] [base=<url>]
/web-custom-provider remove id=<id>
```

Values with spaces need double quotes. The `id` can't be changed later. A bad
URL or wrong key aborts `add` with the endpoint's error — nothing gets saved.

Select your models with the built-in `/models`, rotate keys with `/connect` —
your custom provider appears in both like a native one.

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