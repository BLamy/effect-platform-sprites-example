import path from "node:path"

import createEffectLanguageServicePlugin from "@effect/language-service"
import * as ts from "typescript"

const appRoot = process.cwd()
const virtualRoot = path.join(appRoot, ".effect-language-service")

export interface EffectEditorDiagnostic {
  readonly code: string
  readonly message: string
  readonly severity: "error" | "warning" | "info" | "hint"
  readonly source: string
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
}

interface VirtualFile {
  readonly source: string
  readonly version: number
}

const virtualFiles = new Map<string, VirtualFile>()

const compilerOptions: ts.CompilerOptions = {
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
}

const languageServiceHost: ts.LanguageServiceHost = {
  getCompilationSettings: () => compilerOptions,
  getCurrentDirectory: () => appRoot,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  getDirectories: ts.sys.getDirectories,
  getNewLine: () => ts.sys.newLine,
  getScriptFileNames: () => Array.from(virtualFiles.keys()),
  getScriptKind: () => ts.ScriptKind.TS,
  getScriptSnapshot: (fileName) => {
    const source =
      virtualFiles.get(fileName)?.source ?? ts.sys.readFile(fileName)
    return source === undefined
      ? undefined
      : ts.ScriptSnapshot.fromString(source)
  },
  getScriptVersion: (fileName) =>
    virtualFiles.get(fileName)?.version.toString() ?? "0",
  readDirectory: ts.sys.readDirectory,
  readFile: (fileName) =>
    virtualFiles.get(fileName)?.source ?? ts.sys.readFile(fileName),
  realpath: ts.sys.realpath,
  useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  directoryExists: (directoryName) =>
    directoryName === virtualRoot || ts.sys.directoryExists(directoryName),
  fileExists: (fileName) =>
    virtualFiles.has(fileName) || ts.sys.fileExists(fileName),
}

let languageService: ts.LanguageService | undefined

function getLanguageService() {
  if (languageService) {
    return languageService
  }

  const baseLanguageService = ts.createLanguageService(languageServiceHost)
  languageService = createEffectLanguageServicePlugin({
    typescript: ts,
  }).create({
    config: {
      diagnostics: true,
      diagnosticsName: true,
    },
    languageService: baseLanguageService,
    languageServiceHost,
    project: {
      log: () => undefined,
    },
  })

  return languageService
}

function toVirtualFileName(fileName: string) {
  const safeName = fileName
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80)

  return path.join(
    virtualRoot,
    safeName.endsWith(".ts") ? safeName : `${safeName}.ts`
  )
}

function updateVirtualFile(fileName: string, source: string) {
  const previous = virtualFiles.get(fileName)
  virtualFiles.set(fileName, {
    source,
    version: previous ? previous.version + 1 : 1,
  })
}

function diagnosticSeverity(category: ts.DiagnosticCategory) {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error"
    case ts.DiagnosticCategory.Warning:
      return "warning"
    case ts.DiagnosticCategory.Suggestion:
      return "hint"
    case ts.DiagnosticCategory.Message:
    default:
      return "info"
  }
}

function toEditorDiagnostic(
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic
): EffectEditorDiagnostic {
  const start = diagnostic.start ?? 0
  const length = diagnostic.length ?? 1
  const end = Math.max(start + length, start + 1)
  const startPosition = sourceFile.getLineAndCharacterOfPosition(start)
  const endPosition = sourceFile.getLineAndCharacterOfPosition(end)

  return {
    code: `TS${diagnostic.code}`,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    severity: diagnosticSeverity(diagnostic.category),
    source: diagnostic.source ?? "typescript",
    startLineNumber: startPosition.line + 1,
    startColumn: startPosition.character + 1,
    endLineNumber: endPosition.line + 1,
    endColumn: endPosition.character + 1,
  }
}

export function getEffectLanguageDiagnostics(input: {
  readonly fileName: string
  readonly source: string
}) {
  const fileName = toVirtualFileName(input.fileName)
  updateVirtualFile(fileName, input.source)

  const service = getLanguageService()
  const program = service.getProgram()
  const sourceFile = program?.getSourceFile(fileName)

  if (!sourceFile) {
    return []
  }

  const diagnostics = [
    ...service.getSyntacticDiagnostics(fileName),
    ...service.getSemanticDiagnostics(fileName),
  ]

  return diagnostics
    .filter((diagnostic) => diagnostic.file?.fileName === fileName)
    .map((diagnostic) => toEditorDiagnostic(sourceFile, diagnostic))
}
