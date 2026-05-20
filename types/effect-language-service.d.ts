declare module "@effect/language-service" {
  import type * as ts from "typescript"

  interface EffectLanguageServicePluginInfo {
    readonly languageService: ts.LanguageService
    readonly languageServiceHost: ts.LanguageServiceHost
    readonly config?: unknown
    readonly project: {
      readonly log: (message: string) => void
    }
    readonly session?: unknown
  }

  interface EffectLanguageServicePlugin {
    readonly create: (
      info: EffectLanguageServicePluginInfo
    ) => ts.LanguageService
    readonly onConfigurationChanged?: (config: unknown) => void
  }

  const init: (modules: {
    readonly typescript: typeof ts
  }) => EffectLanguageServicePlugin

  export default init
}

declare module "@effect/language-service/index.js" {
  export { default } from "@effect/language-service"
}
