import { describe, expect, it } from "vitest"

import { createBrowserEffectLanguageService } from "../lib/effect-language-browser-core"

describe("browser Effect language service", () => {
  it("returns no diagnostics for a clean Effect snippet", () => {
    const service = createBrowserEffectLanguageService()
    const result = service.diagnostics({
      fileName: "/virtual/clean.ts",
      source: `
import { Effect } from "effect"

const program = Effect.succeed(1)
`,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("reports TypeScript syntax errors", () => {
    const service = createBrowserEffectLanguageService()
    const result = service.diagnostics({
      fileName: "/virtual/syntax.ts",
      source: "const value =",
    })

    expect(result.diagnostics.some(diagnostic => diagnostic.code === "TS1109")).toBe(
      true
    )
  })

  it("returns hover and completion data from the browser-owned service", () => {
    const service = createBrowserEffectLanguageService()
    const source = `
import { Effect } from "effect"

const program = Effect.succeed(1)
program
`

    const hover = service.hover({
      fileName: "/virtual/hover.ts",
      source,
      lineNumber: 4,
      column: 7,
    })
    const completions = service.completions({
      fileName: "/virtual/hover.ts",
      source,
      lineNumber: 4,
      column: 24,
    })

    expect(hover?.text).toContain("program")
    expect(completions.some(completion => completion.label === "succeed")).toBe(true)
  })
})
