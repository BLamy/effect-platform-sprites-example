import { createBrowserEffectLanguageService } from "../lib/effect-language-browser-core"

type Request =
  | {
      readonly id: number
      readonly type: "diagnostics"
      readonly fileName: string
      readonly source: string
    }
  | {
      readonly id: number
      readonly type: "hover" | "completions"
      readonly fileName: string
      readonly source: string
      readonly lineNumber: number
      readonly column: number
    }

const service = createBrowserEffectLanguageService()

self.addEventListener("message", event => {
  const request = event.data as Request
  try {
    const result =
      request.type === "diagnostics"
        ? service.diagnostics(request)
        : request.type === "hover"
          ? service.hover(request)
          : service.completions(request)

    self.postMessage({ id: request.id, success: true, result })
  } catch (error) {
    self.postMessage({
      id: request.id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
