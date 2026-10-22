/**
 * Regression tests for the edit-dialog decision (extracted from the TUI):
 * the prefilled dialog made "submit unchanged" a common path, which used to
 * trip the server's "edit needs at least one of name or base".
 */
import { describe, expect, it } from "vitest"
import { editSubmission } from "../../src/domain/provider-edit.ts"

const current = { name: "Acme", baseURL: "https://a.dev/v1" }

describe("editSubmission", () => {
  it("reports a no-op when both fields are submitted unchanged", () => {
    expect(editSubmission(current, "Acme", "https://a.dev/v1")).toEqual({ kind: "noop" })
  })

  it("treats whitespace-only differences as unchanged", () => {
    expect(editSubmission(current, "  Acme  ", " https://a.dev/v1 ")).toEqual({ kind: "noop" })
  })

  it("reports a no-op when fields are cleared and nothing else changed", () => {
    expect(editSubmission(current, "", "")).toEqual({ kind: "noop" })
  })

  it("sends a trimmed name change and omits the unchanged base URL", () => {
    expect(editSubmission(current, "  Acme 2  ", "https://a.dev/v1")).toEqual({
      kind: "update",
      name: "Acme 2",
      baseURL: undefined,
    })
  })

  it("sends a base-URL change and omits the unchanged name", () => {
    expect(editSubmission(current, "Acme", "https://b.dev/v1/")).toEqual({
      kind: "update",
      name: undefined,
      baseURL: "https://b.dev/v1/",
    })
  })

  it("sends both fields when both changed", () => {
    expect(editSubmission(current, "New", "https://b.dev/v1")).toEqual({
      kind: "update",
      name: "New",
      baseURL: "https://b.dev/v1",
    })
  })

  it("keeps a cleared field while sending the other change", () => {
    expect(editSubmission(current, "", "https://b.dev/v1")).toEqual({
      kind: "update",
      name: undefined,
      baseURL: "https://b.dev/v1",
    })
  })
})