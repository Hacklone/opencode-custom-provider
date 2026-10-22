import type { Server } from "node:http"

export declare function startMockLlmServer(options?: { port?: number }): Promise<Server>