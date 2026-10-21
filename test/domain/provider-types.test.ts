import { describe, expect, it } from "vitest"
import {
  RESERVED_PROVIDER_IDS,
  ProviderInputError,
  errorMessage,
  normalizeBaseURL,
  slugify,
  validateProviderId,
} from "../../src/domain/provider-types.ts"

describe("slugify", () => {
  it("lowercases and replaces separators", () => {
    expect(slugify("Acme LLM v2")).toBe("acme-llm-v2")
    expect(slugify("  --Weird___Name!!--  ")).toBe("weird-name")
  })

  it("collapses runs of separators", () => {
    expect(slugify("a  b\tc")).toBe("a-b-c")
  })
})

describe("validateProviderId", () => {
  it("accepts slug-shaped ids", () => {
    expect(validateProviderId("acme-1")).toBe("acme-1")
  })

  it("rejects ids with invalid characters", () => {
    expect(() => validateProviderId("Acme")).toThrow(/lowercase/)
    expect(() => validateProviderId("-acme")).toThrow(/lowercase/)
    expect(() => validateProviderId("a b")).toThrow(/lowercase/)
    expect(() => validateProviderId("")).toThrow(/lowercase/)
  })

  it("rejects ids longer than 64 characters", () => {
    expect(() => validateProviderId("a".repeat(65))).toThrow(/exceeds 64/)
    expect(validateProviderId("a".repeat(64))).toBe("a".repeat(64))
  })

  it("rejects reserved built-in ids", () => {
    expect(RESERVED_PROVIDER_IDS.has("openai")).toBe(true)
    expect(() => validateProviderId("openai")).toThrow(/reserved/)
  })
})

describe("normalizeBaseURL", () => {
  it("accepts http(s) URLs and strips trailing slashes", () => {
    expect(normalizeBaseURL("https://api.example.com/v1/")).toBe("https://api.example.com/v1")
    expect(normalizeBaseURL("  http://127.0.0.1:8000/v1  ")).toBe("http://127.0.0.1:8000/v1")
  })

  it("rejects unparseable and non-http URLs", () => {
    expect(() => normalizeBaseURL("not a url")).toThrow(/not a valid http/)
    expect(() => normalizeBaseURL("ftp://files.example.com")).toThrow(/not a valid http/)
  })
})

describe("errorMessage", () => {
  it("prefers Error messages", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
  })

  it("stringifies non-Error throws", () => {
    expect(errorMessage(42)).toBe("42")
    expect(errorMessage("plain string")).toBe("plain string")
  })

  it("renders the rpc client's {type, message} throws readably", () => {
    expect(errorMessage({ type: "rpc.invalid_input", message: "Invalid input: expected object" })).toBe(
      "Invalid input: expected object",
    )
  })

  it("turns rpc.unavailable into an actionable hint", () => {
    expect(errorMessage({ type: "rpc.unavailable", message: "RPC is unavailable: custom-provider" })).toBe(
      "the custom-provider service is not available on this OpenCode server — restart OpenCode so the plugin loads, then try again",
    )
    expect(errorMessage({ type: "rpc.unavailable" })).toBe(
      "the custom-provider service is not available on this OpenCode server — restart OpenCode so the plugin loads, then try again",
    )
  })

  it("hints at the server for transport failures", () => {
    expect(errorMessage({ message: "Transport" })).toBe(
      "could not reach the OpenCode server — check that it is running",
    )
  })

  it("falls back to type-only or stringified rendering, never [object Object]", () => {
    expect(errorMessage({ type: "rpc.unknown_kind" })).toBe("rpc.unknown_kind")
    expect(errorMessage({ code: 7 })).toBe('{"code":7}')
    expect(errorMessage(null)).toBe("null")
    const circular: Record<string, unknown> = {}
    circular["self"] = circular
    expect(errorMessage(circular)).toBe("unprintable error")
  })
})

describe("ProviderInputError", () => {
  it("is an Error", () => {
    expect(new ProviderInputError("x")).toBeInstanceOf(Error)
  })
})