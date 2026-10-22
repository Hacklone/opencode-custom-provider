/**
 * Credential seam backed by OpenCode's safe store. `null` means keyless: no
 * credential exists (or it is being cleared). Implementations never log or
 * expose secret material beyond the resolved return value.
 */
export interface CredentialStore {
  save(id: string, key: string | null): Promise<void>
  resolve(id: string): Promise<string | null>
  remove(id: string): Promise<void>
  /**
   * Make the integration visible to /connect WITHOUT saving a key. Best
   * effort: implementations swallow failures (the storage fallback keeps
   * resolution working either way). Needed at setup restore because
   * integration registration otherwise only happens inside `save`.
   */
  ensureRegistered(id: string): Promise<void>
}