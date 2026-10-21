import { describe, expect, it } from "vitest"
import {
  RESERVED_PROVIDER_IDS,
  ProviderInputError,
  errorMessage,
  slugify,
  validateBaseURL,
  validateName,
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

describe("validateName", () => {
  it("trims and accepts non-empty names", () => {
    expect(validateName("  Acme  ")).toBe("Acme")
  })

  it("rejects empty names", () => {
    expect(() => validateName("   ")).toThrow(/name must not be empty/)
  })

  it("rejects names over 128 characters", () => {
    expect(() => validateName("n".repeat(129))).toThrow(/exceeds 128/)
  })
})

describe("validateBaseURL", () => {
  it("accepts http(s) URLs and strips trailing slashes", () => {
    expect(validateBaseURL("https://api.example.com/v1/")).toBe("https://api.example.com/v1")
    expect(validateBaseURL("http://127.0.0.1:8000/v1")).toBe("http://127.0.0.1:8000/v1")
  })

  it("rejects unparseable URLs", () => {
    expect(() => validateBaseURL("not a url")).toThrow(/not a valid URL/)
  })

  it("rejects non-http protocols", () => {
    expect(() => validateBaseURL("ftp://files.example.com")).toThrow(/http or https/)
  })
})

describe("errorMessage", () => {
  it("prefers Error messages", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
  })

  it("stringifies non-Error throws", () => {
    expect(errorMessage(42)).toBe("42")
  })
})

describe("ProviderInputError", () => {
  it("is an Error", () => {
    expect(new ProviderInputError("x")).toBeInstanceOf(Error)
  })
})