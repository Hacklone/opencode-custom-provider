import type { SessionControl } from "../ports/session-control.ts"

/** Minimal structural view of the plugin ctx surfaces used for selection. */
export interface SelectionContext {
  model: {
    transform(callback: (editor: {
      default: { set(providerID: string, modelID: string): void }
    }) => void): Promise<{ dispose(): void }>
    reload(): Promise<void>
  }
}

/**
 * Catalog default via a single captured model transform: the callback replays
 * the current default on every registry rebuild; setDefault mutates the
 * holder and reloads. Calling `ctx.model.transform` per change would instead
 * accumulate transforms forever.
 */
export class OpencodeSessionControl implements SessionControl {
  private current: { providerID: string; modelID: string } | null = null

  constructor(private readonly ctx: SelectionContext) {}

  /** Registers the replaying default-model transform. Call once at setup. */
  async bootstrap(): Promise<{ dispose(): void }> {
    return await this.ctx.model.transform((editor) => {
      if (this.current !== null) editor.default.set(this.current.providerID, this.current.modelID)
    })
  }

  async setDefault(providerID: string, modelID: string): Promise<void> {
    this.current = { providerID, modelID }
    await this.ctx.model.reload()
  }
}