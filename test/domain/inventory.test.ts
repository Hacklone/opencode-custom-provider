import { describe, expect, it } from "vitest"
import { FALLBACK_CONTEXT_LIMIT, FALLBACK_OUTPUT_LIMIT, parseModelsResponse, seedsFromIds } from "../../src/domain/inventory.ts"

describe("parseModelsResponse", () => {
  it("reads the OpenAI shape and dedupes", () => {
    expect(parseModelsResponse({ data: [{ id: "a" }, { id: "b" }, { id: "a" }] })).toEqual(["a", "b"])
  })

  it("reads a bare array", () => {
    expect(parseModelsResponse([{ id: "x" }])).toEqual(["x"])
  })

  it("rejects non-object non-array bodies", () => {
    expect(() => parseModelsResponse("nope")).toThrow(/models response must be an object/)
    expect(() => parseModelsResponse(null)).toThrow(/models response must be an object/)
  })

  it("rejects missing or non-array data", () => {
    expect(() => parseModelsResponse({})).toThrow(/models response data must be an array/)
    expect(() => parseModelsResponse({ data: "nope" })).toThrow(/models response data must be an array/)
  })

  it("rejects non-object entries", () => {
    expect(() => parseModelsResponse({ data: ["a"] })).toThrow(/entry 0 must be an object/)
  })

  it("rejects entries without a non-empty string id", () => {
    expect(() => parseModelsResponse({ data: [{ id: 1 }] })).toThrow(/entry 0 id/)
    expect(() => parseModelsResponse({ data: [{ id: "" }] })).toThrow(/entry 0 id/)
    expect(() => parseModelsResponse({ data: [{}, { id: "ok" }] })).toThrow(/entry 0 id/)
  })
})

describe("seedsFromIds", () => {
  it("names each seed after its id", () => {
    expect(seedsFromIds(["a", "b"])).toEqual([
      { id: "a", name: "a" },
      { id: "b", name: "b" },
    ])
  })
})

describe("fallback limits", () => {
  it("match the documented uncatalogued-model assumptions", () => {
    expect(FALLBACK_CONTEXT_LIMIT).toBe(200_000)
    expect(FALLBACK_OUTPUT_LIMIT).toBe(32_000)
  })
})