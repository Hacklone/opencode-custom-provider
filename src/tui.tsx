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
 * named `custom-provider-connect` / `custom-provider-models`; the TUI keeps
 * the short `/custom-connect` and `/custom-models` dialogs.
 */
import { Plugin } from "@opencode/plugin/tui"
import { CustomProviderRpc, type ProviderStatus } from "../rpc.ts"

export default Plugin.define({
  id: "custom-provider",
  async setup(context) {
    const rpc = () => context.client.rpc(CustomProviderRpc)
    const rpcOptions = () => ({ location: context.location })

    const toastError = (error: unknown) => {
      context.ui.toast.show({
        title: "Custom provider",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    }

    const fetchProviders = async (): Promise<ProviderStatus[]> => {
      return (await rpc().status({}, rpcOptions())).providers
    }

    const providerDescription = (p: ProviderStatus): string =>
      `${p.baseURL} · ${p.modelCount} models · ${p.hasCredential ? "credential saved" : "keyless"}`

    const addFlow = async () => {
      const name = await context.ui.dialog.prompt({ title: "Provider name", placeholder: "Acme" })
      if (name === undefined || name.trim().length === 0) return
      const baseURL = await context.ui.dialog.prompt({
        title: "Base URL",
        placeholder: "https://api.example.com/v1",
      })
      if (baseURL === undefined || baseURL.trim().length === 0) return
      const key = await context.ui.dialog.prompt({
        title: "API key",
        placeholder: "Paste the key — leave empty for a keyless endpoint",
        // No masking: DialogPromptOptions has no secret/mask option (verified
        // against @opencode/plugin tui 2.0.32), so the key is echoed as-is.
      })
      if (key === undefined) return
      const status = await rpc().connect(
        {
          name: name.trim(),
          baseURL: baseURL.trim(),
          key: key.trim().length > 0 ? key.trim() : null,
        },
        rpcOptions(),
      )
      context.ui.toast.show({
        title: "Custom provider added",
        message: `${status.name} → ${status.baseURL} · ${status.modelCount} models`,
        variant: "success",
      })
    }

    const editFlow = async (provider: ProviderStatus) => {
      const name = await context.ui.dialog.prompt({ title: "Provider name", placeholder: provider.name })
      if (name === undefined) return
      const baseURL = await context.ui.dialog.prompt({ title: "Base URL", placeholder: provider.baseURL })
      if (baseURL === undefined) return
      const key = await context.ui.dialog.prompt({
        title: "API key",
        placeholder: provider.hasCredential ? "Saved — type a new key to replace, empty keeps it" : "Empty keeps this endpoint keyless",
      })
      if (key === undefined) return
      const status = await rpc().edit(
        {
          id: provider.id,
          name: name.trim().length > 0 ? name.trim() : undefined,
          baseURL: baseURL.trim().length > 0 ? baseURL.trim() : undefined,
          key: key.trim().length > 0 ? key.trim() : undefined,
        },
        rpcOptions(),
      )
      context.ui.toast.show({
        title: "Custom provider updated",
        message: `${status.name} → ${status.baseURL} · ${status.modelCount} models`,
        variant: "success",
      })
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
          if (picked === "add") await addFlow()
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
        const provider = await context.ui.dialog.select<ProviderStatus>({
          title: "Models — pick a provider",
          options: providers.map((p) => ({
            value: p,
            title: `${p.name} (${p.id})`,
            description: providerDescription(p),
          })),
        })
        if (provider === undefined) return
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