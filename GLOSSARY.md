# Glossary

**Custom Provider**
A user-defined OpenAI-compatible API endpoint, registered into OpenCode at runtime by this plugin. Identified by a provider ID chosen by the user. Holds a base URL and one credential. Distinct from OpenCode's built-in providers and from an OpenCode *integration* (which is the storage surface for its credential).

**Inventory**
The list of models a Custom Provider exposes, as reported by the endpoint's `GET /v1/models`. Refreshed only on demand (at connect, after a base-URL edit, or via the provider dialog's refresh action) — never in the background.

**Registration**
The act of making a Custom Provider and its Inventory visible to OpenCode for the current and future sessions. Performed through OpenCode's provider/model transform APIs; no config file is ever written.

**Credential**
The API key for a Custom Provider, held in OpenCode's safe store via the integration API — the same mechanism built-in providers use. One credential per Custom Provider; a second account is modeled as a second Custom Provider. A Credential may be absent (keyless endpoints).