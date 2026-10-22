import { Plugin } from "@opencode/plugin"
import { CustomProviderService } from "../application/custom-provider-service.ts"
import { HttpEndpointClient } from "../adapters/http-endpoint.ts"
import { OpencodeStorage } from "./storage.ts"
import { StorageProviderStore } from "./provider-store.ts"
import { OpencodeCredentials } from "./credentials.ts"
import { OpencodeCatalog } from "./catalog.ts"
import { OpencodeSessionControl } from "./session-control.ts"
import {
  formatStatus,
  parseConnectArgs,
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
      // Server command name differs from the TUI slash entry on purpose:
      // the user-confirmed shadowing gotcha (palette shows both, and the
      // same-named entry loses to the server command) makes distinct names
      // the documented fallback. The TUI keeps the /custom-provider dialog;
      // this arg-grammar command serves the web UI. Model selection needs no
      // command: custom models appear in OpenCode's built-in /models picker.
      editor.add({
        name: "web-custom-provider",
        description:
          "Custom providers (web UI): /web-custom-provider | add id=<id> name=<Name> base=<url> [key=<key>] | edit id=<id> [name=<Name>] [base=<url>] | remove id=<id>",
        execute: async ({ sessionID, prompt }) => {
          const text = prompt.text.replace(/^\/web-custom-provider\b\s*/i, "")
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
                })
                reply = formatStatus([status])
                break
              }
              case "remove": {
                const { hadCredential } = await service.remove(action.id)
                reply = hadCredential
                  ? `Removed custom provider "${action.id}" — its API key remains in the safe store. Delete it via /connect ("custom-provider: ${action.id}") or \`opencode auth logout ${action.id}\`.`
                  : `Removed custom provider "${action.id}"`
                break
              }
            }
            await say(sessionID, reply)
          } catch (error) {
            await say(sessionID, `Custom provider error: ${errorMessage(error)}`)
          }
        },
      })
    })

    /** Minimal structural view of the RPC handler context (second argument). */
interface RpcHandlerContext {
  error(type: string, message: string, data?: Record<string, unknown>): unknown
}

    /**
     * Handler failures MUST be surfaced as the declared `provider_error`
     * (returned via context.error): a plain throw becomes a server DEFECT and
     * the client only sees the generic "RPC call failed" with the real
     * message swallowed (verified live via the service log, 2026-10-22).
     */
    const guard = <H>(context: RpcHandlerContext, run: () => Promise<H>): Promise<H> =>
      run().catch((error: unknown): H => context.error("provider_error", errorMessage(error), {}) as H)

    const rpcRegistration = await ctx.rpc.register(CustomProviderRpc, {
      status: (_input, context) => guard(context, async () => ({ providers: await service.list() })),
      connect: (input, context) => guard(context, () => service.add(input)),
      edit: (input, context) => guard(context, () => service.edit(input.id, {
        name: input.name,
        baseURL: input.baseURL,
      })),
      remove: (input, context) => guard(context, () => service.remove(input.id)),
      refresh: (input, context) => guard(context, async () => ({ id: input.id, models: await service.refresh(input.id) })),
    })

    return () => {
      commandRegistration.dispose()
      rpcRegistration.dispose()
      catalogTransform.dispose()
      modelTransform.dispose()
    }
  },
})