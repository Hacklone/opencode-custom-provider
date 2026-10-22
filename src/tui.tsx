/** @jsxImportSource @opentui/solid */
/**
 * TUI plugin: dialog flows over the same RPC methods the web UI reaches via
 * server commands. One service on the server means the clients cannot drift.
 *
 * RPC calls MUST carry the TUI location: rpc handlers are resolved per
 * location, and a project-local plugin's handlers are invisible to a
 * location-less request ("RPC is unavailable", verified live 2026-10-21 —
 * the exact bug that made /custom-connect report an error).
 *
 * NOTE (shadowing gotcha, CONFIRMED live): same-named server commands and TUI
 * slash entries both appear in the palette. The server commands are therefore
 * named `web-custom-connect` / `web-custom-models`; the TUI keeps the short
 * `/custom-connect` and `/custom-models` dialogs.
 */
import { Plugin } from "@opencode/plugin/tui"
import { errorMessage } from "./domain/provider-types.ts"
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
      const health = p.lastError === undefined ? "" : ` · LAST REFRESH FAILED: ${p.lastError}`
      return `${p.baseURL} · ${p.modelCount} models · ${p.hasCredential ? "credential saved" : "keyless"}${health}`
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
      let name = provider.name
      let baseURL = provider.baseURL
      let key = ""
      for (;;) {
        const nextName = await context.ui.dialog.prompt({ title: "Provider name", placeholder: name, value: name === provider.name ? undefined : name })
        if (nextName === undefined) return
        name = nextName.trim()
        const nextBaseURL = await context.ui.dialog.prompt({ title: "Base URL", placeholder: baseURL, value: baseURL === provider.baseURL ? undefined : baseURL })
        if (nextBaseURL === undefined) return
        baseURL = nextBaseURL.trim()
        const nextKey = await context.ui.dialog.prompt({
          title: "API key",
          placeholder: provider.hasCredential ? "Saved — type a new key to replace, empty keeps it" : "Empty keeps this endpoint keyless",
          value: key === "" ? undefined : key,
        })
        if (nextKey === undefined) return
        key = nextKey.trim()
        try {
          const status = await rpc().edit(
            {
              id: provider.id,
              name: name !== provider.name && name.length > 0 ? name : undefined,
              baseURL: baseURL !== provider.baseURL && baseURL.length > 0 ? baseURL : undefined,
              key: key.length > 0 ? key : undefined,
            },
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
        }
      }
    }

    const removeFlow = async (provider: ProviderStatus) => {
      const confirmed = await context.ui.dialog.confirm({
        title: `Remove ${provider.name}?`,
        message: `Provider "${provider.id}" and its saved credential registration will be removed.`,
      })
      if (confirmed !== true) return
      await rpc().remove({ id: provider.id }, rpcOptions())
      context.ui.toast.show({
        title: "Custom provider removed",
        message: provider.id,
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
        const action = await context.ui.dialog.select<"edit" | "remove">({
          title: `${picked.name} (${picked.id})`,
          options: [
            { value: "edit", title: "Edit", description: "Rename, change base URL, or rotate the key" },
            { value: "remove", title: "Remove", description: "Unregister and drop its credential" },
          ],
        })
        if (action === "edit") await editFlow(picked)
        else if (action === "remove") await removeFlow(picked)
      } catch (error) {
        toastError(error)
      }
    }

    const modelsFlow = async () => {
      try {
        const providers = await fetchProviders()
        if (providers.length === 0) {
          context.ui.toast.show({
            title: "Custom providers",
            message: "No custom providers yet — run /custom-connect to add one",
            variant: "info",
          })
          return
        }
        const provider = await context.ui.dialog.select<ProviderStatus | "add">({
          title: "Models — pick a provider",
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
        if (provider === undefined) return
        if (provider === "add") {
          await addFlow(searchQuery)
          return
        }
        const models = (await rpc().refresh({ id: provider.id }, rpcOptions())).models
        if (models.length === 0) {
          context.ui.toast.show({
            title: provider.name,
            message: "The endpoint returned no models",
            variant: "warning",
          })
          return
        }
        const modelID = await context.ui.dialog.select<string>({
          title: `${provider.name} models`,
          options: models.map((id) => ({ value: id, title: id })),
        })
        if (modelID === undefined) return
        const what = await context.ui.dialog.select<"session" | "default">({
          title: `${provider.id}/${modelID}`,
          options: [
            { value: "session", title: "Use in this session", description: "Switches the current session's model" },
            { value: "default", title: "Make default", description: "New sessions start on this model" },
          ],
        })
        if (what === "session") {
          const route = context.ui.router.current()
          if (route.type !== "session") {
            context.ui.toast.show({
              title: "No session open",
              message: "Open a session first, then pick a model",
              variant: "warning",
            })
            return
          }
          await rpc().switchSession({ sessionID: route.sessionID, providerID: provider.id, modelID }, rpcOptions())
          context.ui.toast.show({
            title: "Model switched",
            message: `${provider.id}/${modelID}`,
            variant: "success",
          })
        } else if (what === "default") {
          await rpc().setDefault({ providerID: provider.id, modelID }, rpcOptions())
          context.ui.toast.show({
            title: "Default model set",
            message: `${provider.id}/${modelID}`,
            variant: "success",
          })
        }
      } catch (error) {
        toastError(error)
      }
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "custom-provider.connect",
          title: "Custom providers",
          description: "Add, edit, or remove custom OpenAI-compatible providers",
          group: "Custom providers",
          palette: true,
          slash: { name: "custom-connect" },
          suggested: true,
          run: () => void connectFlow(),
        },
        {
          id: "custom-provider.models",
          title: "Custom provider models",
          description: "Refresh a custom provider's inventory and pick a model",
          group: "Custom providers",
          palette: true,
          slash: { name: "custom-models" },
          suggested: true,
          run: () => void modelsFlow(),
        },
      ],
    }))
  },
})