import { z } from "zod"
import { Rpc } from "@opencode/plugin/rpc"

/**
 * Server↔TUI contract. Schemas MUST be zod (Standard Schema): the runtime's
 * rpc.register silently ignores raw JSON Schema literals (empirical).
 */
const providerStatus = z.object({
  id: z.string(),
  name: z.string(),
  baseURL: z.string(),
  modelCount: z.number(),
  hasCredential: z.boolean(),
  lastError: z.string().optional(),
})

export type ProviderStatus = z.infer<typeof providerStatus>

export const CustomProviderRpc = Rpc.define({
  id: "custom-provider",
  methods: {
    status: {
      input: z.object({}),
      output: z.object({ providers: z.array(providerStatus) }),
    },
    connect: {
      input: z.object({
        id: z.string().optional(),
        name: z.string(),
        baseURL: z.string(),
        key: z.string().nullable().optional(),
      }),
      output: providerStatus,
    },
    edit: {
      input: z.object({
        id: z.string(),
        name: z.string().optional(),
        baseURL: z.string().optional(),
        key: z.string().nullable().optional(),
      }),
      output: providerStatus,
    },
    remove: {
      input: z.object({ id: z.string() }),
      output: z.object({}),
    },
    refresh: {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string(), models: z.array(z.string()) }),
    },
    setDefault: {
      input: z.object({ providerID: z.string(), modelID: z.string() }),
      output: z.object({}),
    },
    switchSession: {
      input: z.object({ sessionID: z.string(), providerID: z.string(), modelID: z.string() }),
      output: z.object({}),
    },
  },
  events: {},
})