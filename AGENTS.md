# AGENTS.md

Rules for working in this repository. The plugin registers user-defined
OpenAI-compatible providers at runtime (`/custom-connect`), keeps their API
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
- **Transforms are synchronous**: `ctx.provider.transform` callbacks may not
  await. Load data (model lists, credentials) before the callback, then call
  `ctx.provider.reload()` after the captured inputs change.
- **Registry rebuild is fresh**: every `reload()` replays active transforms
  onto a fresh value. A provider that the transform no longer adds disappears
  by itself — unregistering is `Map.delete` + `reload()`, not `editor.remove`.
- **Command-name shadowing (CONFIRMED live 2026-10-21)**: a server command
  with the SAME name as a TUI client slash entry shows up twice in the
  palette. The fallback is applied: the server command is named
  `web-custom-connect` (web UI, arg grammar), while the TUI keeps the
  `/custom-connect` dialog.
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
- Determinism: no sleeps, no real network, no real clocks.
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
```

Live smoke test: copy `src/` into a sandbox project's
`.opencode/plugins/custom-provider/` keeping the root `index.ts` shim (local
discovery loads `<dir>/index.ts` directly; the package.json `exports` map is
only honored for npm installs), then run `opencode` and exercise
`/custom-connect` (TUI) or `/web-custom-connect` (web UI).

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