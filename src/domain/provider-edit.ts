/**
 * The TUI edit-dialog decision, extracted from src/tui.tsx so it is testable:
 * the dialog prefills the current values, so "submit unchanged" is a natural
 * no-op that must NOT reach the server (it would trip "edit needs at least
 * one of name or base"), while a cleared field keeps the current value.
 */
export type EditSubmission =
  | { kind: "noop" }
  | { kind: "update"; name?: string; baseURL?: string }

export function editSubmission(
  current: { name: string; baseURL: string },
  rawName: string,
  rawBaseURL: string,
): EditSubmission {
  const name = rawName.trim()
  const baseURL = rawBaseURL.trim()
  // An unchanged or cleared field is omitted from the patch; a whitespace-
  // only difference from the current value counts as unchanged.
  const nextName = name !== current.name && name.length > 0 ? name : undefined
  const nextBaseURL = baseURL !== current.baseURL && baseURL.length > 0 ? baseURL : undefined
  if (nextName === undefined && nextBaseURL === undefined) return { kind: "noop" }
  return { kind: "update", name: nextName, baseURL: nextBaseURL }
}