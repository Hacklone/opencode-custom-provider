# ADR 0001: Credentials in the safe store via the integration API

Date: 2026-10-21
Status: Accepted

## Context

A Custom Provider needs an API key for its OpenAI-compatible endpoint. Three
storage options existed:

1. Plugin storage (`ctx.storage`) — private to the plugin, invisible to
   `/connect` and `opencode auth list`, no masking/lifecycle support.
2. `settings.apiKey` in a generated config file — requires writing config
   files, which the plugin design forbids, and stores secrets in plaintext
   config.
3. OpenCode's safe store (SQLite credential store) via the integration API —
   the same mechanism built-in providers use; keys are masked, manageable from
   `/connect` and `opencode auth list`, and never written to config files.

## Decision

Register one integration per Custom Provider (`ctx.integration.transform`) and
save its key with `ctx.integration.connect.key({ integrationID, key })`.
Link the provider to the integration with `Provider.Info.integrationID` and
ALSO embed the resolved key in `Provider.Info.settings.apiKey` at registration
time.

## Why the dual mechanism

- `settings.apiKey` is the documented configuration mechanism for providers
  and guarantees authenticated requests even if integration-linked credential
  resolution turns out not to apply to plugin-registered integrations.
- `integrationID` keeps the provider linked to `/connect`-managed accounts so
  key rotation through OpenCode's own UI stays possible.

## Consequences

- Keyless endpoints are supported: no credential is saved; the provider
  registers without `apiKey`.
- The key is mirrored into plugin storage as a fallback because integration
  upsert semantics are not guaranteed; resolution order is integration
  connection first, plugin storage second.
- Secrets never appear in logs, status output, or error messages — credential
  status is reported as a boolean only.
- A refresh (connect, edit with baseURL/key change, explicit refresh)
  re-registers the provider, re-resolving the current credential so an embedded
  key never goes stale across those actions.