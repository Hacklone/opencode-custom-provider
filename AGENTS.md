# AGENTS.md

Rules for working in this repository. The plugin registers user-defined
OpenAI-compatible providers at runtime (`/custom-provider`), keeps their API
keys in OpenCode's safe store, and loads each provider's model inventory from
`GET {baseURL}/v1/models` on demand. Architecture and conventions are cloned
from `@coool/opencode-decision-mode`.

## Architecture (non-negotiable)

- **Dependency rule**: `src/domain/`, `src/application/`, and `src/ports/` never
  import `@opencode/plugin`, `@opencode/schema`, or any platform SDK. Only
  `src/adapters/` and `src/opencode/` touch the platform.
- **Extraction test**: every application service must be instantiable with
  fakes alone. If a service needs the real plugin context to be constructed or
  tested, the seam is wrong — add a port.
- **Domain is pure vocabulary**: types, validation, normalization. No I/O, no
  clocks, no randomness.
- **Ports are the only seams**: application code depends on port interfaces;
  adapters implement ports. Never import an adapter from application code.
- **No dead knobs**: a parameter that no caller sets is removed, not kept "for
  later".

## TypeScript conventions

- `strict` + `noUncheckedIndexedAccess` always on. No `any`.
- Non-null assertions (`!`) only where the invariant is provable and stated in
  a comment.
- Validate at the boundary (command args, RPC input), trust types inside.
  Invalid input throws with a message that names the offending field — the
  message is the user's (or model's) only feedback.
- Provider responses are untrusted: `/v1/models` payloads are normalized
  through defensive readers, and a malformed payload is a hard error, never
  silently coerced.

## Plugin invariants (empirical OpenCode knowledge)

- **Feedback must not wake the model**: command feedback is admitted via
  `ctx.session.synthetic({ sessionID, text, resume: false })` — synthetic input
  schedules a model turn by default, which would silently wake the controller
  on every status command.
- **RPC schemas must be zod (Standard Schema)**: raw JSON Schema literals are
  silently ignored by `ctx.rpc.register` (verified empirically in
  decision-mode).
- **RPC handler failures must be declared + returned via `context.error`**
  (verified live 2026-10-22 via the service log): a plain `throw` inside an
  rpc handler becomes a server DEFECT — the runtime logs
  "rpc handler failed" and answers with the generic
  `{type:"rpc.internal",message:"RPC call failed"}`, swallowing the real
  message. Every method therefore declares
  `errors: { provider_error: z.object({}) }` and every handler wraps its
  service call in `guard()`, returning
  `context.error("provider_error", errorMessage(error), {})`. The client then
  rejects with `{type, message}` and the real message survives.
- **Transforms are synchronous**: `ctx.provider.transform` callbacks may not
  await. Load data (model lists, credentials) before the callback, then call
  `ctx.provider.reload()` after the captured inputs change.
- **Registry rebuild is fresh**: every `reload()` replays active transforms
  onto a fresh value. A provider that the transform no longer adds disappears
  by itself — unregistering is `Map.delete` + `reload()`, not `editor.remove`.
- **Command-name shadowing (CONFIRMED live 2026-10-21)**: a server command
  with the SAME name as a TUI client slash entry shows up twice in the
  palette. The fallback is applied: the server command is named
  `web-custom-provider` (web UI, arg grammar), while the TUI keeps the
  `/custom-provider` dialog.
- **RPC handlers are location-scoped**: `ctx.rpc.register` handlers resolve
  against the CALLER's location. A location-less request resolves the plugin
  for the default location (home) and fails with
  `{"type":"rpc.unavailable"}` — which the TUI surfaces as a generic error.
  Every TUI rpc call must pass `{ location: context.location }` as the
  RpcCallOptions second argument (verified live: the same request with
  `?location[directory]=…` returns 200). Global plugins (installed in
  `~/.config/opencode/plugins`) are location-independent and mask this bug —
  test with a project-local install.
- **Secrets never leak into logs or status output**: credential status is a
  boolean; error messages never include key material.
- **Credential dual-write**: the API key is saved to the safe store via
  `ctx.integration.connect.key` (so `/connect` and `opencode auth list` see it)
  AND mirrored into plugin storage as a fallback, because integration upsert
  semantics are not guaranteed. Resolution order: integration connection first,
  storage fallback second.
- **Removed providers keep their safe-store credentials (verified live
  2026-10-22)**: `ctx.credential` exposes only `activate` (checked in 2.0.32
  AND 2.1.2) — plugins cannot delete credentials — and integration
  `editor.remove` does not cascade. On remove WITH a key the plugin-storage
  fallback is dropped but the integration registration is deliberately KEPT,
  so `/connect` and `opencode auth logout <id>` can still manage the saved
  accounts (verified: once deregistered, `opencode auth logout <id>` fails
  with "Integration not found"). The kept integration is registry state and
  disappears at the next restart; truly orphaned credentials remain in SQLite
  and can only be removed via `DELETE /api/credential/<credentialID>`. Each
  key save accumulates one credential entry (native account behavior).

## Model registration

- Provider `settings.apiKey` is embedded at registration time (resolved from
  the credential store) in addition to `Provider.Info.integrationID` as a
  fallback for the no-active-credential case. **Verified live (OpenCode
  2.1.2)**: OpenCode resolves the integration credential at REQUEST time and
  it WINS over the embedded `settings.apiKey` — a key rotated in `/connect`
  takes effect immediately, no re-registration needed. Key management is
  therefore delegated to the built-in `/connect` dialog (the plugin still
  saves the initial key so `/connect` has an account to activate).
- Adding a provider automatically sets its first discovered model as the
  catalog default (`ctx.model.transform` default holder + `ctx.model.reload()`).
- Discovered models use OpenCode's uncatalogued-model fallbacks: tools +
  text/image input, text output, 200k context, 32k output. No per-model
  overrides in v1.
- **No background refresh**: inventory is fetched only on connect, edit
  (base-URL change), or explicit refresh. Setup restores providers from
  storage with zero network calls (offline-tolerant); a failed refresh keeps
  the stored inventory and reports the error.

## Testing rules

- **Coverage gate is 100%** for statements, branches, functions, and lines. If
  a branch is unreachable, delete the branch instead of weakening the gate.
- Tests assert behavior through public methods with in-memory fakes
  (`test/fakes.ts`). Adapters are tested with injected/mocked dependencies.
- The TUI entry (`src/tui.tsx`) only runs inside OpenTUI and stays manually
  verified — but its DECISION logic must live in `src/domain/` (pure,
  unit-tested), not inline in the JSX. The edit-dialog decision is
  `src/domain/provider-edit.ts`; extract new dialog decisions the same way.
- Determinism: no sleeps, no real network, no real clocks. Exception: the
  `scripts/mock-llm` integration tests start the mock in-process on an
  ephemeral loopback port — loopback only, never an external network.
- Bug fixes add a regression test that fails without the fix.

## Live smoke test findings (verified 2026-10-21 against OpenCode 2.1.1)

- Local `.opencode/plugins/<dir>` plugins resolve imports from their own
  directory tree. If the plugin lives outside a project with matching
  `node_modules`, dependency resolution fails (`Cannot find package 'zod'`).
  For a repo checkout, symlink or install `node_modules` next to the plugin
  directory (npm-installed plugins don't have this problem).
- The full server-side flow was verified end-to-end against a mock
  OpenAI-compatible endpoint: connect (validate-before-save, credential
  created in the safe store as `type=key active=true`), base-URL edit
  re-fetch, refresh, auto-default on add (`/api/model/default` follows), a
  REAL chat completion round-trip through the registered provider (Bearer
  auth accepted), remove (provider and integration both disappear), and
  offline restore after a cold restart with the endpoint unreachable
  (inventory intact, zero network at setup).
- Integration registration (the `/connect` visibility) only happens inside
  `credentials.save` — a provider restored at setup would NOT appear in
  `/connect` until its `ensureRegistered` runs (fixed in 0.1.5: restoreAll
  registers every restored provider). Each key save accumulates a new
  credential entry in the safe store (native account behavior; latest is
  active).
- `/api/model` and `/api/provider` snapshots may precede initial plugin
  settlement — an empty read right after boot does not mean restore failed;
  query the RPC status or wait for settlement.
- `POST /api/session/{id}/command` does not execute plugin-registered server
  commands from raw API calls (404 despite `/api/command` listing them).
  Client (TUI/web) invocation and the command-shadowing behavior are still
  verified manually, not via raw API.

## Verification workflow

```sh
npm install          # once
npm run typecheck    # tsc --noEmit — must be clean
npm test             # vitest + 100% coverage gate
npm run e2e          # server-level e2e against a real opencode serve
npm run e2e:tui      # TUI-level e2e: drives a real TUI via termwright
```

## Server-level e2e (`scripts/e2e.mjs`)

- Boots the mock LLM in-process, builds a throwaway sandbox
  (`.opencode/plugins/custom-provider` with shims + src + node_modules
  symlink), spawns a real `opencode serve`, and drives the full lifecycle
  over HTTP with fail-fast assertions: settlement, connect (inventory +
  credential), provider/model/integration/credential visibility, auto-default,
  a REAL chat round-trip ("MOCK-OK via <model>"), baseURL-edit refetch,
  validate-before-save rejection, refresh, remove (leftover-credential
  reporting), and offline restore across a cold restart.
- **Isolation**: the serve gets its own `OPENCODE_DB` and `XDG_DATA_HOME`
  inside the sandbox — the user's real safe store and service are never
  touched. `E2E_KEEP=1` keeps the sandbox for post-mortem.
- **Serve auth is HTTP Basic `opencode:<password>`** (verified in
  @opencode/client's service wiring) — Bearer is rejected.
- **`opencode serve` may detach its real server into a grandchild** that
  outlives the spawned child (orphaned, PPID 1, keeps the listen socket).
  stopServe therefore SIGTERMs the child, then SIGKILLs whatever still holds
  the port (`lsof -tiTCP:<port>`).
- **`process.exit` inside a try skips its `finally`** — the PASS print and
  exit live after the try/finally, so teardown always runs (verified: the
  serve survived when the exit preceded it).
- `/api/plugin` does NOT list locally-discovered plugins — the rpc
  settlement poll is the "plugin loaded" proof, not `/api/plugin`.
- The rpc route body is `{"input": …}`; a missing input must serialize as
  `{}` (JSON.stringify drops undefined keys; a bare `{}` body is rejected).
- A foreign location in the rpc query resolves to a 400 **LocationNotFoundError**
  (not "rpc.unavailable" — that shape only appears for unknown rpcIDs).
- The mock endpoint (`scripts/mock-llm/server.mjs`) takes `noAuth: true` for
  keyless-endpoint tests (an authed mock 401s a keyless inventory fetch) and
  exposes `server.counts.models` — the harness asserts with it who fetched
  the inventory (rename must not refetch; baseURL edit must).

## TUI-level e2e (`scripts/e2e-tui.mjs`)

- Drives a REAL TUI through the `/custom-provider` dialog flows with
  [termwright](https://github.com/fcoury/termwright) (`cargo install
  termwright`): add (name → base URL → key), edit (rename), no-op edit
  ("Nothing to change"), refresh, remove (confirm dialog + leftover-key
  note) — asserting screen text via `wait_for_text` and server state via
  HTTP between steps.
- **The CLI needs the sandbox directory as an explicit argument**:
  `opencode --server <url> <dir>`. Location discovery otherwise falls back
  to the home directory and the local `.opencode/plugins` TUI plugin never
  loads (the palette shows "No matching commands").
- **The CLI needs `--server` + `OPENCODE_PASSWORD`**: without it, service
  discovery can land on the user's global service (its provider/model state
  showed through a fresh sandbox otherwise).
- Dialog navigation: arrow keys for selects (the action select has no
  search callback); prefilled prompt values are cleared with repeated
  Backspace; never use fixed sleeps — `wait_for_text` everywhere.

Live smoke test: copy `src/` into a sandbox project's
`.opencode/plugins/custom-provider/` keeping the root `index.ts` shim (local
discovery loads `<dir>/index.ts` directly; the package.json `exports` map is
only honored for npm installs), then run `opencode` and exercise
`/custom-provider` (TUI) or `/web-custom-provider` (web UI).

## Publishing

- `files: ["src", "tsconfig.json"]` — the npm tarball is compiled in a cache
  dir where the loader's tsconfig lookup finds nothing.
- TUI files start with `/** @jsxImportSource @opentui/solid */`.
- Version bumps are commits named exactly after the version (`0.1.1`), tagged
  `vX.Y.Z`.

## Style

- Concise, imperative code; comments explain *why* (invariants, empirical
  findings), never restate the code.
- No speculative exports or re-exports; each module's surface is what its
  consumers use.