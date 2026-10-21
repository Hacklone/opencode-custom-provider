/** @jsxImportSource @opentui/solid */
/**
 * TUI plugin: dialog flows over the same RPC methods the web UI reaches via
 * server commands. One service on the server means the clients cannot drift.
 *
 * NOTE (shadowing gotcha): the server registers commands named exactly
 * `custom-connect` / `custom-models`, and the TUI registers slash entries with
 * the same names. decision-mode empirically found that a same-named server
 * command shadows the TUI slash entry (Enter submits literal text to the
 * model). Verify against a live TUI; if Enter submits text, rename the SERVER
 * commands and keep these slash entries.
 */
import { Plugin } from "@opencode/plugin/tui"
import { CustomProviderRpc, type ProviderStatus } from "../rpc.ts"

export default Plugin.define({
  id: "custom-provider",
  async setup(context) {
    const rpc = () => context.client.rpc(CustomProviderRpc)

    const toastError = (error: unknown) => {
      context.ui.toast.show({
        title: "Custom provider",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    }

    const pickProvider = async (title: string): Promise<ProviderStatus | undefined> => {
      const providers = (await rpc().status({})).providers
      if (providers.length === 0) {
        context.ui.toast.show({
          title: "Custom providers",
          message: "No custom providers yet — run /custom-connect to add one",
          variant: "info",
        })
        return undefined
      }
      return await context.ui.dialog.select<ProviderStatus>({
        title,
        options: providers.map((p) => ({
          value: p,
          title: `${p.name} (${p.id})`,
          description: `${p.baseURL} · ${p.modelCount} models · ${p.hasCredential ? "credential saved" : "keyless"}`,
        })),
      })
    }

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
      })
      if (key === undefined) return
      const status = await rpc().connect({
        name: name.trim(),
        baseURL: baseURL.trim(),
        key: key.trim().length > 0 ? key.trim() : null,
      })
      context.ui.toast.show({
        title: "Custom provider added",
        message: `${status.name} → ${status.baseURL} · ${status.modelCount} models`,
        variant: "success",
      })
    }

    const editFlow = async () => {
      const provider = await pickProvider("Edit which provider?")
      if (provider === undefined) return
      const name = await context.ui.dialog.prompt({ title: "Provider name", placeholder: provider.name })
      if (name === undefined) return
      const baseURL = await context.ui.dialog.prompt({ title: "Base URL", placeholder: provider.baseURL })
      if (baseURL === undefined) return
      const key = await context.ui.dialog.prompt({
        title: "API key",
        placeholder: provider.hasCredential ? "Saved — type a new key to replace, empty keeps it" : "Empty keeps this endpoint keyless",
      })
      if (key === undefined) return
      const status = await rpc().edit({
        id: provider.id,
        name: name.trim().length > 0 ? name.trim() : undefined,
        baseURL: baseURL.trim().length > 0 ? baseURL.trim() : undefined,
        key: key.trim().length > 0 ? key.trim() : undefined,
      })
      context.ui.toast.show({
        title: "Custom provider updated",
        message: `${status.name} → ${status.baseURL} · ${status.modelCount} models`,
        variant: "success",
      })
    }

    const removeFlow = async () => {
      const provider = await pickProvider("Remove which provider?")
      if (provider === undefined) return
      const confirmed = await context.ui.dialog.confirm({
        title: `Remove ${provider.name}?`,
        message: `Provider "${provider.id}" and its saved credential registration will be removed.`,
      })
      if (confirmed !== true) return
      await rpc().remove({ id: provider.id })
      context.ui.toast.show({
        title: "Custom provider removed",
        message: provider.id,
        variant: "success",
      })
    }

    const statusFlow = async () => {
      const providers = (await rpc().status({})).providers
      if (providers.length === 0) {
        await context.ui.dialog.alert({
          title: "Custom providers",
          message: "None yet — run /custom-connect to add one.",
        })
        return
      }
      await context.ui.dialog.alert({
        title: "Custom providers",
        message: providers
          .map((p) => `${p.id} · ${p.modelCount} models · ${p.hasCredential ? "credential saved" : "keyless"}`)
          .join("\n"),
      })
    }

    const connectFlow = async () => {
      try {
        const action = await context.ui.dialog.select<string>({
          title: "Custom providers",
          options: [
            { value: "add", title: "Add a provider", description: "Register a new OpenAI-compatible endpoint" },
            { value: "edit", title: "Edit a provider", description: "Rename, change base URL, or rotate the key" },
            { value: "remove", title: "Remove a provider", description: "Unregister and drop its credential" },
            { value: "status", title: "Status", description: "List registered providers" },
          ],
        })
        if (action === "add") await addFlow()
        else if (action === "edit") await editFlow()
        else if (action === "remove") await removeFlow()
        else if (action === "status") await statusFlow()
      } catch (error) {
        toastError(error)
      }
    }

    const modelsFlow = async () => {
      try {
        const provider = await pickProvider("Refresh which provider?")
        if (provider === undefined) return
        const models = (await rpc().refresh({ id: provider.id })).models
        const modelID = await context.ui.dialog.select<string>({
          title: `${provider.name} models`,
          options: models.map((id) => ({ value: id, title: id })),
        })
        if (modelID === undefined) return
        const what = await context.ui.dialog.select<string>({
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
          await rpc().switchSession({ sessionID: route.sessionID, providerID: provider.id, modelID })
          context.ui.toast.show({
            title: "Model switched",
            message: `${provider.id}/${modelID}`,
            variant: "success",
          })
        } else if (what === "default") {
          await rpc().setDefault({ providerID: provider.id, modelID })
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
          description: "Add, edit, remove, or list custom OpenAI-compatible providers",
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