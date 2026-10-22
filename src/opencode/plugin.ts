import { Plugin } from "@opencode/plugin"
import { CustomProviderService } from "../application/custom-provider-service.ts"
import { HttpEndpointClient } from "../adapters/http-endpoint.ts"
import { OpencodeStorage } from "./storage.ts"
import { StorageProviderStore } from "./provider-store.ts"
import { OpencodeCredentials } from "./credentials.ts"
import { OpencodeCatalog } from "./catalog.ts"
import { OpencodeSessionControl } from "./session-control.ts"
import {
  formatModels,
  formatStatus,
  parseConnectArgs,
  parseModelsArgs,
} from "./command.ts"
import { errorMessage } from "../domain/provider-types.ts"
import { CustomProviderRpc } from "../rpc.ts"

export const PLUGIN_ID = "custom-provider"

/**
 * Server plugin. All mutations flow through CustomProviderService; the TUI
 * reaches the same service via RPC, the web UI via the server commands.
 */
export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const storage = new OpencodeStorage(ctx.storage)
    const store = new StorageProviderStore(storage)
    const credentials = new OpencodeCredentials(ctx, storage)
    const endpoint = new HttpEndpointClient()
    const catalog = new OpencodeCatalog(ctx, credentials)
    const selection = new OpencodeSessionControl(ctx)
    const service = new CustomProviderService({ store, credentials, endpoint, catalog, session: selection })

    // Offline-tolerant restore: stored providers come back with their
    // last-known inventory before any network call.
    const catalogTransform = await catalog.bootstrap()
    const modelTransform = await selection.bootstrap()
    await service.restoreAll()

    const say = async (sessionID: string, text: string): Promise<void> => {
      // resume:false — synthetic input schedules a model turn by default; a
      // status/mutation command must not wake the controller.
      await ctx.session.synthetic({ sessionID, text, resume: false })
    }

    const commandRegistration = await ctx.command.transform((editor) => {
      // Server command names differ from the TUI slash entries on purpose:
      // the user-confirmed shadowing gotcha (palette shows both, and the
      // same-named entry loses to the server command) makes distinct names
      // the documented fallback. The TUI keeps /custom-connect and
      // /custom-models dialogs; these arg-grammar commands serve the web UI.
      editor.add({
        name: "web-custom-connect",
        description:
          "Custom providers (web UI): /web-custom-connect | add id=<id> name=<Name> base=<url> [key=<key>] | edit id=<id> [name=<Name>] [base=<url>] [key=<key>] | remove id=<id>",
        execute: async ({ sessionID, prompt }) => {
          const text = prompt.text.replace(/^\/web-custom-connect\b\s*/i, "")
          try {
            const action = parseConnectArgs(text)
            let reply: string
            switch (action.kind) {
              case "status":
                reply = formatStatus(await service.list())
                break
              case "add": {
                const status = await service.add({
                  id: action.id,
                  name: action.name,
                  baseURL: action.baseURL,
                  key: action.key ?? null,
                })
                reply = formatStatus([status])
                break
              }
              case "edit": {
                const status = await service.edit(action.id, {
                  name: action.name,
                  baseURL: action.baseURL,
                  key: action.key,
                })
                reply = formatStatus([status])
                break
              }
              case "remove":
                await service.remove(action.id)
                reply = `Removed custom provider "${action.id}"`
                break
            }
            await say(sessionID, reply)
          } catch (error) {
            await say(sessionID, `Custom provider error: ${errorMessage(error)}`)
          }
        },
      })
      editor.add({
        name: "web-custom-models",
        description:
          "Custom provider models (web UI): /web-custom-models | /web-custom-models <id> | /web-custom-models <id> default <modelID>",
        execute: async ({ sessionID, prompt }) => {
          const text = prompt.text.replace(/^\/web-custom-models\b\s*/i, "")
          try {
            const action = parseModelsArgs(text)
            let reply: string
            switch (action.kind) {
              case "list":
                reply = formatStatus(await service.list())
                break
              case "show":
                reply = formatModels(action.id, await service.refresh(action.id))
                break
              case "setDefault":
                await service.setDefault(action.id, action.modelID)
                await service.switchSession(sessionID, action.id, action.modelID)
                reply = `Default model set to ${action.id}/${action.modelID} and applied to this session`
                break
            }
            await say(sessionID, reply)
          } catch (error) {
            await say(sessionID, `Custom model error: ${errorMessage(error)}`)
          }
        },
      })
    })

    const rpcRegistration = await ctx.rpc.register(CustomProviderRpc, {
      status: async () => ({ providers: await service.list() }),
      connect: async (input) => await service.add(input),
      edit: async (input) => await service.edit(input.id, {
        name: input.name,
        baseURL: input.baseURL,
        key: input.key,
      }),
      remove: async (input) => {
        await service.remove(input.id)
        return {}
      },
      refresh: async (input) => ({ id: input.id, models: await service.refresh(input.id) }),
      setDefault: async (input) => {
        await service.setDefault(input.providerID, input.modelID)
        return {}
      },
      switchSession: async (input) => {
        await service.switchSession(input.sessionID, input.providerID, input.modelID)
        return {}
      },
    })

    return () => {
      commandRegistration.dispose()
      rpcRegistration.dispose()
      catalogTransform.dispose()
      modelTransform.dispose()
    }
  },
})