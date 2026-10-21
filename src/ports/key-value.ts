/**
 * Key-value storage seam. Values are JSON-compatible blobs; the port stays
 * platform-free so application services and opencode adapters agree here.
 * All operations are async: the platform storage domain is async.
 */
export interface KeyValueStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  /** All entries whose key starts with the prefix. */
  scan(prefix: string): Promise<{ key: string; value: unknown }[]>
}