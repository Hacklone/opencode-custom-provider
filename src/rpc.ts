import { z } from "zod"
import { Rpc } from "@opencode/plugin/rpc"

/**
 * Server↔TUI contract. Schemas MUST be zod (Standard Schema): the runtime's
 * rpc.register silently ignores raw JSON Schema literals (empirical).
 *
 * Every method declares `provider_error`: handler failures MUST be returned
 * via the handler context's `error()` helper — a plain throw becomes a server
 * DEFECT and the client only sees the generic "RPC call failed" with the real
 * message swallowed (verified live via the service log, 2026-10-22).
 */
const providerError = { provider_error: z.object({}) }

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
      errors: providerError,
    },
    connect: {
      input: z.object({
        id: z.string().optional(),
        name: z.string(),
        baseURL: z.string(),
        key: z.string().nullable().optional(),
      }),
      output: providerStatus,
      errors: providerError,
    },
    edit: {
      input: z.object({
        id: z.string(),
        name: z.string().optional(),
        baseURL: z.string().optional(),
      }),
      output: providerStatus,
      errors: providerError,
    },
    remove: {
      input: z.object({ id: z.string() }),
      output: z.object({ hadCredential: z.boolean() }),
      errors: providerError,
    },
    refresh: {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string(), models: z.array(z.string()) }),
      errors: providerError,
    },
  },
  events: {},
})