import type { KeyValueStore } from "../ports/key-value.ts"

const MAX_SCAN_PAGES = 100

/**
 * Adapts `ctx.storage` to the KeyValueStore port. `ctx.storage.scan` pages
 * its results via the `after` cursor; the adapter follows the cursor so the
 * port's `scan(prefix)` always sees the whole prefix. The page cap is a
 * runaway-loop guard.
 */
export class OpencodeStorage implements KeyValueStore {
  constructor(private readonly storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    remove(key: string): Promise<void>
    scan(options: { prefix: string; after?: string }): Promise<{ entries: readonly { key: string; value: unknown }[]; next?: string }>
  }) {}

  get(key: string): Promise<unknown> {
    return this.storage.get(key)
  }

  set(key: string, value: unknown): Promise<void> {
    return this.storage.set(key, value)
  }

  remove(key: string): Promise<void> {
    return this.storage.remove(key)
  }

  async scan(prefix: string): Promise<{ key: string; value: unknown }[]> {
    const all: { key: string; value: unknown }[] = []
    let after: string | undefined
    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const result = await this.storage.scan({ prefix, ...(after !== undefined ? { after } : {}) })
      for (const entry of result.entries) {
        if (entry.key.startsWith(prefix)) all.push(entry)
      }
      if (result.next === undefined) return all
      after = result.next
    }
    // Runaway guard tripped; return what we have rather than looping forever.
    return all
  }
}