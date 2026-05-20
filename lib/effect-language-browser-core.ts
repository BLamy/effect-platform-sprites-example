import createEffectLanguageServicePlugin from "@effect/language-service/index.js"
import * as ts from "typescript"

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

export interface EffectEditorHover {
  readonly text: string
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
}

export interface EffectEditorCompletion {
  readonly label: string
  readonly kind: string
  readonly detail?: string
}

const ambientFileName = "/virtual/ambient.d.ts"
const defaultFileName = "/virtual/example.ts"

const ambientSource = `
declare const console: { log(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }
declare const process: { env: Record<string, string | undefined>; stdout: { write(value: string): void }; stderr: { write(value: string): void } }
declare const crypto: { randomUUID(): string }
declare const JSON: { stringify(value: unknown, replacer?: unknown, space?: string | number): string; parse(value: string): unknown }
declare class Date { constructor(value?: unknown); toISOString(): string }
declare class TextDecoder { decode(input?: Uint8Array): string }
interface Uint8Array { readonly length: number }
interface TemplateStringsArray extends ReadonlyArray<string> { readonly raw: readonly string[] }
interface ReadonlyArray<T> { readonly length: number; readonly [n: number]: T; map<U>(callback: (value: T, index: number) => U): U[]; join(separator?: string): string }
interface Array<T> extends ReadonlyArray<T> { push(...items: T[]): number }
interface Promise<T> { then<TResult>(onfulfilled?: (value: T) => TResult | Promise<TResult>): Promise<TResult> }
declare interface PromiseConstructor { new <T>(executor: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T>; resolve<T>(value: T): Promise<T> }
declare const Promise: PromiseConstructor

declare module "effect" {
  export const Effect: {
    succeed(value: unknown): unknown
    gen(value: unknown): unknown
    logInfo(...args: unknown[]): unknown
    void: unknown
  }
  export const Deferred: { make(): unknown; await(value: unknown): unknown; succeed(value: unknown, result: unknown): unknown }
  export const Ref: { make(value: unknown): unknown; get(value: unknown): unknown; update(value: unknown, fn: unknown): unknown }
  export const Layer: { succeed(...args: unknown[]): unknown; mergeAll(...args: unknown[]): unknown }
  export const Stream: unknown
}

declare module "@effect/platform" {
  export const Command: any
  export const FileSystem: any
}

declare module "@effect/platform/Command" {
  export const make: any
  export const string: any
  export const feed: any
  export const env: any
}

declare module "@effect/platform/FileSystem" {
  export const FileSystem: any
}

declare module "@replayio/effect-platform-sprites" {
  export const SpriteClient: any
  export const SpriteContext: any
  export const SpriteRuntime: any
  export const SpriteSession: any
  export const SpriteTerminal: any
  export const sh: any
}
`

const compilerOptions: ts.CompilerOptions = {
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  noLib: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
}

function diagnosticSeverity(category: ts.DiagnosticCategory) {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error" as const
    case ts.DiagnosticCategory.Warning:
      return "warning" as const
    case ts.DiagnosticCategory.Suggestion:
      return "hint" as const
    case ts.DiagnosticCategory.Message:
    default:
      return "info" as const
  }
}

function flatten(parts: readonly ts.SymbolDisplayPart[] | undefined) {
  return parts?.map(part => part.text).join("") ?? ""
}

function toPosition(sourceFile: ts.SourceFile, position: number) {
  const line = sourceFile.getLineAndCharacterOfPosition(position)
  return {
    lineNumber: line.line + 1,
    column: line.character + 1,
  }
}

function offsetAt(sourceFile: ts.SourceFile, lineNumber: number, column: number) {
  return (
    sourceFile.getPositionOfLineAndCharacter(
      Math.max(lineNumber - 1, 0),
      Math.max(column - 1, 0)
    ) ?? 0
  )
}

function diagnosticToEditor(
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic
): EffectEditorDiagnostic {
  const start = diagnostic.start ?? 0
  const length = diagnostic.length ?? 1
  const end = Math.max(start + length, start + 1)
  const startPosition = toPosition(sourceFile, start)
  const endPosition = toPosition(sourceFile, end)

  return {
    code: `TS${diagnostic.code}`,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    severity: diagnosticSeverity(diagnostic.category),
    source: diagnostic.source ?? "typescript",
    startLineNumber: startPosition.lineNumber,
    startColumn: startPosition.column,
    endLineNumber: endPosition.lineNumber,
    endColumn: endPosition.column,
  }
}

export class BrowserEffectLanguageService {
  private readonly files = new Map<string, { source: string; version: number }>([
    [ambientFileName, { source: ambientSource, version: 1 }],
  ])
  private readonly service: ts.LanguageService

  constructor() {
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => compilerOptions,
      getCurrentDirectory: () => "/virtual",
      getDefaultLibFileName: () => ambientFileName,
      getDirectories: () => [],
      getNewLine: () => "\n",
      getScriptFileNames: () => Array.from(this.files.keys()),
      getScriptKind: () => ts.ScriptKind.TS,
      getScriptSnapshot: fileName => {
        const file = this.files.get(fileName)
        return file ? ts.ScriptSnapshot.fromString(file.source) : undefined
      },
      getScriptVersion: fileName =>
        this.files.get(fileName)?.version.toString() ?? "0",
      readFile: fileName => this.files.get(fileName)?.source,
      useCaseSensitiveFileNames: () => true,
      fileExists: fileName => this.files.has(fileName),
    }

    const baseService = ts.createLanguageService(host)
    try {
      this.service = createEffectLanguageServicePlugin({ typescript: ts }).create({
        config: {
          diagnostics: true,
          diagnosticsName: true,
        },
        languageService: baseService,
        languageServiceHost: host,
        project: {
          log: () => undefined,
        },
      })
    } catch {
      this.service = baseService
    }
  }

  updateFile(input: { readonly fileName?: string; readonly source: string }) {
    const fileName = input.fileName ?? defaultFileName
    const previous = this.files.get(fileName)
    this.files.set(fileName, {
      source: input.source,
      version: previous ? previous.version + 1 : 1,
    })
    return fileName
  }

  diagnostics(input: { readonly fileName?: string; readonly source: string }) {
    const startedAt = performance.now()
    const fileName = this.updateFile(input)
    const program = this.service.getProgram()
    const sourceFile = program?.getSourceFile(fileName)
    if (!sourceFile) {
      return { diagnostics: [], durationMs: Math.round(performance.now() - startedAt) }
    }

    const diagnostics = [
      ...this.service.getSyntacticDiagnostics(fileName),
      ...this.service.getSemanticDiagnostics(fileName),
    ]
      .filter(diagnostic => diagnostic.file?.fileName === fileName)
      .map(diagnostic => diagnosticToEditor(sourceFile, diagnostic))

    return {
      diagnostics,
      durationMs: Math.round(performance.now() - startedAt),
    }
  }

  hover(input: {
    readonly fileName?: string
    readonly source: string
    readonly lineNumber: number
    readonly column: number
  }): EffectEditorHover | undefined {
    const fileName = this.updateFile(input)
    const program = this.service.getProgram()
    const sourceFile = program?.getSourceFile(fileName)
    if (!sourceFile) {
      return undefined
    }

    const position = offsetAt(sourceFile, input.lineNumber, input.column)
    const info = this.service.getQuickInfoAtPosition(fileName, position)
    if (!info) {
      return undefined
    }

    const start = info.textSpan.start
    const end = info.textSpan.start + info.textSpan.length
    const startPosition = toPosition(sourceFile, start)
    const endPosition = toPosition(sourceFile, end)
    const documentation = flatten(info.documentation)
    const text = [flatten(info.displayParts), documentation]
      .filter(Boolean)
      .join("\n\n")

    return {
      text,
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column,
    }
  }

  completions(input: {
    readonly fileName?: string
    readonly source: string
    readonly lineNumber: number
    readonly column: number
  }): ReadonlyArray<EffectEditorCompletion> {
    const fileName = this.updateFile(input)
    const program = this.service.getProgram()
    const sourceFile = program?.getSourceFile(fileName)
    if (!sourceFile) {
      return []
    }

    const position = offsetAt(sourceFile, input.lineNumber, input.column)
    return (
      this.service.getCompletionsAtPosition(fileName, position, {})?.entries ?? []
    )
      .slice(0, 80)
      .map(entry => ({
        label: entry.name,
        kind: entry.kind,
        detail: entry.source,
      }))
  }
}

export function createBrowserEffectLanguageService() {
  return new BrowserEffectLanguageService()
}
