import { describe, expect, it } from "vitest"
import {
  formatModels,
  formatStatus,
  parseConnectArgs,
  parseModelsArgs,
} from "../../src/opencode/command.ts"

describe("parseConnectArgs", () => {
  it("parses status when no args are given", () => {
    expect(parseConnectArgs("")).toEqual({ kind: "status" })
    expect(parseConnectArgs("   ")).toEqual({ kind: "status" })
  })

  it("parses add with all keys", () => {
    expect(
      parseConnectArgs("add id=acme name=Acme base=https://a.dev/v1 key=sk-1"),
    ).toEqual({ kind: "add", id: "acme", name: "Acme", baseURL: "https://a.dev/v1", key: "sk-1" })
  })

  it("parses add without id and key", () => {
    expect(parseConnectArgs("add name=Acme base=https://a.dev/v1")).toEqual({
      kind: "add",
      name: "Acme",
      baseURL: "https://a.dev/v1",
    })
  })

  it("parses values containing equal signs", () => {
    const action = parseConnectArgs("add name=N base=https://a.dev/v1 key=sk=1")
    expect(action).toEqual({ kind: "add", name: "N", baseURL: "https://a.dev/v1", key: "sk=1" })
  })

  it("parses edit patches", () => {
    expect(parseConnectArgs("edit id=acme name=New base=https://b.dev/v1 key=sk-2")).toEqual({
      kind: "edit",
      id: "acme",
      name: "New",
      baseURL: "https://b.dev/v1",
      key: "sk-2",
    })
    expect(parseConnectArgs("edit id=acme")).toEqual({ kind: "edit", id: "acme" })
  })

  it("parses remove", () => {
    expect(parseConnectArgs("remove id=acme")).toEqual({ kind: "remove", id: "acme" })
  })

  it("rejects add without name or base", () => {
    expect(() => parseConnectArgs("add id=acme")).toThrow(/add requires name/)
    expect(() => parseConnectArgs("add name=N")).toThrow(/add requires name/)
  })

  it("rejects edit and remove without id", () => {
    expect(() => parseConnectArgs("edit name=N")).toThrow(/edit requires id/)
    expect(() => parseConnectArgs("remove")).toThrow(/remove requires id/)
  })

  it("rejects unknown actions and arguments", () => {
    expect(() => parseConnectArgs("bogus")).toThrow(/unknown action "bogus"/)
    expect(() => parseConnectArgs("add name=N base=u color=red")).toThrow(/unknown argument "color"/)
    expect(() => parseConnectArgs("add name")).toThrow(/must be key=<value>/)
    expect(() => parseConnectArgs("add =x")).toThrow(/must be key=<value>/)
  })

  it("keeps double-quoted values as one token", () => {
    expect(parseConnectArgs('add name="My Provider" base=https://a.dev/v1')).toEqual({
      kind: "add",
      name: "My Provider",
      baseURL: "https://a.dev/v1",
    })
    expect(parseConnectArgs('edit id=acme name="New Name"')).toEqual({
      kind: "edit",
      id: "acme",
      name: "New Name",
    })
    expect(parseConnectArgs('add name="A B" base=u')).toEqual({
      kind: "add",
      name: "A B",
      baseURL: "u",
    })
  })

  it("extends an unterminated quote to the end of the input", () => {
    expect(() => parseConnectArgs('add name="Acme base=https://a.dev/v1')).toThrow(/add requires name/)
  })
})

describe("parseModelsArgs", () => {
  it("parses the list action", () => {
    expect(parseModelsArgs("")).toEqual({ kind: "list" })
  })

  it("parses show and setDefault", () => {
    expect(parseModelsArgs("acme")).toEqual({ kind: "show", id: "acme" })
    expect(parseModelsArgs("acme default m1")).toEqual({ kind: "setDefault", id: "acme", modelID: "m1" })
  })

  it("rejects unknown actions and bare keywords", () => {
    expect(() => parseModelsArgs("default m1")).toThrow(/unknown action "m1"/)
    expect(() => parseModelsArgs("acme default")).toThrow(/default requires a model id/)
    expect(() => parseModelsArgs("acme default m1 extra")).toThrow(/default requires a model id/)
  })

  it("rejects unknown actions", () => {
    expect(() => parseModelsArgs("acme bogus m1")).toThrow(/unknown action "bogus"/)
  })
})

describe("formatStatus", () => {
  it("shows the add hint when empty", () => {
    expect(formatStatus([])).toMatch(/none — add one with/)
  })

  it("lists providers with credential state", () => {
    const text = formatStatus([
      { id: "acme", name: "Acme", baseURL: "https://a.dev/v1", modelCount: 3, hasCredential: true },
      { id: "local", name: "Local", baseURL: "http://127.0.0.1:8000/v1", modelCount: 0, hasCredential: false },
    ])
    expect(text).toContain("- acme (Acme) → https://a.dev/v1 · 3 models · credential saved")
    expect(text).toContain("- local (Local) → http://127.0.0.1:8000/v1 · 0 models · keyless")
  })
})

describe("formatModels", () => {
  it("lists model refs", () => {
    expect(formatModels("acme", ["m1", "m2"])).toBe("Models for acme:\n- acme/m1\n- acme/m2")
  })
})