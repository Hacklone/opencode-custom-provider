/** Model selection seam: catalog default + per-session switch. */
export interface SessionControl {
  setDefault(providerID: string, modelID: string): Promise<void>
  switchSession(sessionID: string, providerID: string, modelID: string): Promise<void>
}