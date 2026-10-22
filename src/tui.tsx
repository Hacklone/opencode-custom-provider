/** @jsxImportSource @opentui/solid */
/**
 * TUI plugin: dialog flows over the same RPC methods the web UI reaches via
 * the web-custom-provider server command. One service on the server means the
 * clients cannot drift.
 *
 * Model selection needs no dialog here: custom provider models appear in
 * OpenCode's built-in /models picker (verified live 2026-10-22), and key
 * rotation is delegated to the built-in /connect (the integration credential
 * is resolved at request time and wins over settings.apiKey).
 *
 * RPC calls MUST carry the TUI location: rpc handlers are resolved per
 * location, and a project-local plugin's handlers are invisible to a
 * location-less request ("RPC is unavailable", verified live 2026-10-21 —
 * the exact bug that made /custom-provider report an error).
 *
 * NOTE (shadowing gotcha, CONFIRMED live): same-named server commands and TUI
 * slash entries both appear in the palette. The server command is therefore
 * named `web-custom-provider`; the TUI keeps the `/custom-provider` dialog.
 */
import { Plugin } from "@opencode/plugin/tui"
import { errorMessage } from "./domain/provider-types.ts"
import { editSubmission } from "./domain/provider-edit.ts"
import { CustomProviderRpc, type ProviderStatus } from "../rpc.ts"

export default Plugin.define({
  id: "custom-provider",
  async setup(context) {
    const rpc = () => context.client.rpc(CustomProviderRpc)
    const rpcOptions = () => ({ location: context.location })

    const toastError = (error: unknown) => {
      context.ui.toast.show({
        title: "Custom provider",
        message: errorMessage(error),
        variant: "error",
      })
    }

    const fetchProviders = async (): Promise<ProviderStatus[]> => {
      return (await rpc().status({}, rpcOptions())).providers
    }

    const providerDescription = (p: ProviderStatus): string => {
      // The failure marker goes FIRST: dialog descriptions truncate, and a
      // health problem buried at the end is never seen (verified in e2e-tui).
      const health = p.lastError === undefined ? "" : `LAST REFRESH FAILED: ${p.lastError} · `
      return `${health}${p.baseURL} · ${p.modelCount} models · ${p.hasCredential ? "credential saved" : "keyless"}`
    }

    // Query text the user had typed when a dialog option was picked; the
    // search callback tracks it per keystroke, so "Add new provider" can
    // prefill the name with what was searched for.
    let searchQuery = ""

    /** Filter that keeps the "Add new provider" escape hatch visible when the
     * query matches nothing, so a typo never dead-ends the dialog. */
    const searchKeepingAdd =
      <Value,>(addValue: Value) =>
      (query: string, options: readonly { value: Value; title: string; description?: string }[]) => {
        searchQuery = query.trim()
        const q = searchQuery.toLowerCase()
        const matches = options.filter(
          (o) => q === "" || `${o.title} ${o.description ?? ""}`.toLowerCase().includes(q),
        )
        const add = options.find((o) => o.value === addValue)
        if (add !== undefined && !matches.includes(add) && matches.length === 0) return [add]
        return matches
      }

    const addFlow = async (prefill = "") => {
      // Validation failures loop back to the prompts with the entered values
      // kept, so a typo in the key or URL never costs the whole form.
      let name = prefill.trim()
      let baseURL = ""
      let key = ""
      for (;;) {
        const nextName = await context.ui.dialog.prompt({ title: "Provider name", placeholder: "Acme", value: name === "" ? undefined : name })
        if (nextName === undefined || nextName.trim().length === 0) return
        name = nextName.trim()
        const nextBaseURL = await context.ui.dialog.prompt({
          title: "Base URL",
          placeholder: "https://api.example.com/v1",
          value: baseURL === "" ? undefined : baseURL,
        })
        if (nextBaseURL === undefined) return
        baseURL = nextBaseURL.trim()
        const nextKey = await context.ui.dialog.prompt({
          title: "API key",
          placeholder: "Paste the key — leave empty for a keyless endpoint",
          value: key === "" ? undefined : key,
          // No masking: DialogPromptOptions has no secret/mask option (verified
          // against @opencode/plugin tui 2.0.32), so the key is echoed as-is.
        })
        if (nextKey === undefined) return
        key = nextKey.trim()
        try {
          const status = await rpc().connect(
            {
              name,
              baseURL,
              key: key.length > 0 ? key : null,
            },
            rpcOptions(),
          )
          context.ui.toast.show({
            title: "Custom provider added",
            message: `${status.name} → ${status.baseURL} · ${status.modelCount} models`,
            variant: "success",
          })
          return
        } catch (error) {
          await context.ui.dialog.alert({
            title: `Could not add ${name}`,
            message: `${errorMessage(error)}\n\nThe values are kept — fix them and try again, or press Esc to cancel.`,
          })
        }
      }
    }

    const editFlow = async (provider: ProviderStatus) => {
      // Key rotation is NOT part of the edit flow: rotate via the built-in
      // /connect (the active credential wins at request time and our
      // resolve() sees it instantly). The fields arrive PREFILLED with the
      // current values — submitting unchanged is a no-op, clearing a field
      // keeps the current value, Esc cancels. On a validation failure the
      // loop re-prompts with the attempted values still filled in.
      let name = provider.name
      let baseURL = provider.baseURL
      for (;;) {
        const nextName = await context.ui.dialog.prompt({ title: "Provider name", placeholder: name, value: name })
        if (nextName === undefined) return
        const nextBaseURL = await context.ui.dialog.prompt({ title: "Base URL", placeholder: baseURL, value: baseURL })
        if (nextBaseURL === undefined) return
        // Decision extracted to domain (tested): unchanged submit is a no-op,
        // cleared fields keep the current value.
        const submission = editSubmission(provider, nextName, nextBaseURL)
        if (submission.kind === "noop") {
          context.ui.toast.show({ title: "Nothing to change", message: provider.id, variant: "info" })
          return
        }
        try {
          const status = await rpc().edit(
            { id: provider.id, name: submission.name, baseURL: submission.baseURL },
            rpcOptions(),
          )
          context.ui.toast.show({
            title: "Custom provider updated",
            message: `${status.name} → ${status.baseURL} · ${status.modelCount} models`,
            variant: "success",
          })
          return
        } catch (error) {
          await context.ui.dialog.alert({
            title: `Could not update ${provider.name}`,
            message: `${errorMessage(error)}\n\nThe values are kept — fix them and try again, or press Esc to cancel.`,
          })
          // Re-prompt with the attempted values still filled in.
          name = submission.name ?? provider.name
          baseURL = submission.baseURL ?? provider.baseURL
        }
      }
    }

    const removeFlow = async (provider: ProviderStatus) => {
      const confirmed = await context.ui.dialog.confirm({
        title: `Remove ${provider.name}?`,
        message: provider.hasCredential
          ? `Provider "${provider.id}" will be unregistered. Its API key stays in OpenCode's safe store — delete it afterwards via /connect.`
          : `Provider "${provider.id}" will be unregistered.`,
      })
      if (confirmed !== true) return
      const { hadCredential } = await rpc().remove({ id: provider.id }, rpcOptions())
      context.ui.toast.show({
        title: "Custom provider removed",
        message: hadCredential
          ? `${provider.id} — its API key remains in the safe store. Delete it via /connect ("custom-provider: ${provider.id}") or "opencode auth logout ${provider.id}".`
          : provider.id,
        variant: "success",
      })
    }

    const connectFlow = async () => {
      try {
        const providers = await fetchProviders()
        const picked = await context.ui.dialog.select<ProviderStatus | "add">({
          title: "Custom providers",
          search: searchKeepingAdd<ProviderStatus | "add">("add"),
          options: [
            ...providers.map((p) => ({
              value: p,
              title: `${p.name} (${p.id})`,
              description: providerDescription(p),
            })),
            { value: "add", title: "Add new provider", description: "Register a new OpenAI-compatible endpoint" },
          ],
        })
        if (picked === undefined || picked === "add") {
          if (picked === "add") await addFlow(searchQuery)
          return
        }
        const action = await context.ui.dialog.select<"edit" | "refresh" | "remove">({
          title: `${picked.name} (${picked.id})`,
          options: [
            { value: "edit", title: "Edit", description: "Rename or change the base URL (rotate keys via /connect)" },
            { value: "refresh", title: "Refresh", description: "Re-fetch the model inventory from the endpoint" },
            { value: "remove", title: "Remove", description: "Unregister the provider" },
          ],
        })
        if (action === "edit") await editFlow(picked)
        else if (action === "refresh") {
          const models = await rpc().refresh({ id: picked.id }, rpcOptions()).then((r) => r.models)
          context.ui.toast.show({
            title: "Inventory refreshed",
            message: `${picked.name} · ${models.length} models`,
            variant: "success",
          })
        } else if (action === "remove") await removeFlow(picked)
      } catch (error) {
        toastError(error)
      }
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "custom-provider.manage",
          title: "Custom providers",
          description: "Add, edit, or remove custom OpenAI-compatible providers",
          group: "Custom providers",
          palette: true,
          slash: { name: "custom-provider" },
          suggested: true,
          run: () => void connectFlow(),
        },
      ],
    }))
  },
})