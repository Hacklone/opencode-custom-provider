import { describe, expect, it } from "vitest"
import { OpencodeSessionControl } from "../../src/opencode/session-control.ts"

function makeCtx() {
  const recorded: { providerID: string; modelID: string }[] = []
  const disposables: string[] = []
  const transforms: ((editor: { default: { set(providerID: string, modelID: string): void } }) => void)[] = []
  const ctx = {
    model: {
      transform: async (callback: (editor: { default: { set(providerID: string, modelID: string): void } }) => void) => {
        transforms.push(callback)
        return {
          dispose: () => {
            disposables.push("model")
          },
        }
      },
      reload: async () => {
        // Replay every registered transform, mirroring the real registry rebuild.
        for (const callback of transforms) {
          callback({
            default: {
              set: (providerID, modelID) => recorded.push({ providerID, modelID }),
            },
          })
        }
      },
    },
  }
  return { ctx, recorded, transforms, disposables }
}

describe("OpencodeSessionControl", () => {
  it("bootstraps one replaying transform and disposes it", async () => {
    const { ctx, transforms, disposables } = makeCtx()
    const control = new OpencodeSessionControl(ctx)
    const registration = await control.bootstrap()
    expect(transforms).toHaveLength(1)
    registration.dispose()
    expect(disposables).toEqual(["model"])
  })

  it("sets no default until one is chosen", async () => {
    const { ctx, transforms, recorded } = makeCtx()
    const control = new OpencodeSessionControl(ctx)
    await control.bootstrap()
    // Replay the bootstrap transform manually: no default chosen yet.
    transforms[0]?.({ default: { set: (p, m) => recorded.push({ providerID: p, modelID: m }) } })
    expect(recorded).toEqual([])
  })

  it("publishes the default on reload and keeps the latest choice", async () => {
    const { ctx, recorded } = makeCtx()
    const control = new OpencodeSessionControl(ctx)
    await control.bootstrap()
    await control.setDefault("acme", "m1")
    await control.setDefault("acme", "m2")
    expect(recorded).toEqual([
      { providerID: "acme", modelID: "m1" },
      { providerID: "acme", modelID: "m2" },
    ])
  })
})