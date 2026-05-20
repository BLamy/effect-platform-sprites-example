"use client"

import { AlertCircle, CheckCircle2, Loader2, TriangleAlert } from "lucide-react"
import dynamic from "next/dynamic"
import { useEffect, useRef, useState } from "react"

import type { Monaco, OnMount } from "@monaco-editor/react"
import type { editor } from "monaco-editor"

import { effectLanguageClient } from "@/lib/effect-language-client"
import type { EffectEditorDiagnostic } from "@/lib/effect-language-browser-core"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 min-w-0 items-center rounded-lg border bg-zinc-950 p-4 font-mono text-[0.8rem] text-zinc-400">
      Loading editor...
    </div>
  ),
})

const languageId = "typescript-shell-template"
const themeId = "sprite-docs-dark"

let monacoConfigured = false

type DiagnosticsState =
  | {
      readonly status: "idle"
      readonly diagnostics: ReadonlyArray<EffectEditorDiagnostic>
    }
  | {
      readonly status: "checking"
      readonly diagnostics: ReadonlyArray<EffectEditorDiagnostic>
    }
  | {
      readonly status: "ready"
      readonly diagnostics: ReadonlyArray<EffectEditorDiagnostic>
      readonly durationMs: number
    }
  | {
      readonly status: "error"
      readonly diagnostics: ReadonlyArray<EffectEditorDiagnostic>
      readonly error: string
    }

const typescriptKeywords = [
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "of",
  "return",
  "satisfies",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "while",
  "yield",
]

const typeKeywords = [
  "boolean",
  "never",
  "number",
  "object",
  "readonly",
  "string",
  "unknown",
  "void",
]

function configureMonaco(monaco: Monaco) {
  if (monacoConfigured) {
    return
  }

  monacoConfigured = true

  if (
    !monaco.languages
      .getLanguages()
      .some((language: { readonly id: string }) => language.id === languageId)
  ) {
    monaco.languages.register({
      id: languageId,
      aliases: ["TypeScript with shell templates"],
    })
  }

  monaco.languages.setMonarchTokensProvider(languageId, {
    defaultToken: "",
    tokenPostfix: ".ts",
    keywords: typescriptKeywords,
    typeKeywords,
    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    operators: [
      "=",
      ">",
      "<",
      "!",
      "~",
      "?",
      ":",
      "==",
      "<=",
      ">=",
      "!=",
      "&&",
      "||",
      "++",
      "--",
      "+",
      "-",
      "*",
      "/",
      "&",
      "|",
      "^",
      "%",
      "<<",
      ">>",
      ">>>",
      "+=",
      "-=",
      "*=",
      "/=",
      "&=",
      "|=",
      "^=",
      "%=",
      "<<=",
      ">>=",
      ">>>=",
      "=>",
    ],
    tokenizer: {
      root: [
        [
          /(sh)(\s*)(`)/,
          [
            "tag.shell",
            "white",
            { token: "string.backtick.shell", next: "@shellTemplate" },
          ],
        ],
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/[{}()[\]]/, "@brackets"],
        [
          /[a-zA-Z_$][\w$]*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@default": "identifier",
            },
          },
        ],
        [/[A-Z][\w$]*/, "type.identifier"],
        [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
        [/\d+/, "number"],
        [/"/, "string", "@stringDouble"],
        [/'/, "string", "@stringSingle"],
        [/`/, "string.backtick", "@templateString"],
        [
          /@symbols/,
          {
            cases: {
              "@operators": "operator",
              "@default": "",
            },
          },
        ],
        [/[;,.]/, "delimiter"],
        [/\s+/, "white"],
      ],
      shellTemplate: [
        [/`/, { token: "string.backtick.shell", next: "@pop" }],
        [/\$\{/, { token: "delimiter.bracket", next: "@tsInterpolation" }],
        [/#.*$/, "comment.shell"],
        [
          /\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|select|until)\b/,
          "keyword.shell",
        ],
        [
          /\b(set|export|cd|rm|npm|npx|printf|echo|cat|mkdir|cp|mv|test|true|false)\b/,
          "predefined.shell",
        ],
        [/--[A-Za-z0-9][\w-]*/, "attribute.name.shell"],
        [/\$[A-Za-z_]\w*/, "variable.shell"],
        [/"([^"\\]|\\.)*"/, "string.shell"],
        [/'[^']*'/, "string.shell"],
        [/[;&|<>]+/, "operator.shell"],
        [/[(){}[\]]/, "@brackets"],
        [/[^\s`$#"';&|<>(){}[\]]+/, "source.shell"],
        [/\s+/, "white"],
        [/./, "source.shell"],
      ],
      tsInterpolation: [
        [/\}/, { token: "delimiter.bracket", next: "@pop" }],
        { include: "root" },
      ],
      templateString: [
        [/`/, { token: "string.backtick", next: "@pop" }],
        [/\$\{/, { token: "delimiter.bracket", next: "@tsInterpolation" }],
        [/[^`$]+/, "string"],
        [/./, "string"],
      ],
      stringDouble: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, { token: "string", next: "@pop" }],
      ],
      stringSingle: [
        [/[^\\']+/, "string"],
        [/\\./, "string.escape"],
        [/'/, { token: "string", next: "@pop" }],
      ],
      comment: [
        [/[^\/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[\/*]/, "comment"],
      ],
    },
  })

  monaco.editor.defineTheme(themeId, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "tag.shell", foreground: "a7f3d0", fontStyle: "bold" },
      { token: "keyword", foreground: "93c5fd" },
      { token: "type", foreground: "c4b5fd" },
      { token: "type.identifier", foreground: "f0abfc" },
      { token: "comment", foreground: "71717a" },
      { token: "string", foreground: "facc15" },
      { token: "string.shell", foreground: "fde68a" },
      { token: "keyword.shell", foreground: "60a5fa", fontStyle: "bold" },
      { token: "predefined.shell", foreground: "34d399" },
      { token: "attribute.name.shell", foreground: "fbbf24" },
      { token: "variable.shell", foreground: "f472b6" },
      { token: "operator.shell", foreground: "fda4af" },
      { token: "source.shell", foreground: "e4e4e7" },
      { token: "number", foreground: "fdba74" },
      { token: "operator", foreground: "cbd5e1" },
      { token: "delimiter", foreground: "a1a1aa" },
    ],
    colors: {
      "editor.background": "#09090b",
      "editor.foreground": "#f4f4f5",
      "editor.lineHighlightBackground": "#18181b",
      "editorLineNumber.foreground": "#52525b",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editor.selectionBackground": "#065f46",
      "editor.inactiveSelectionBackground": "#064e3b66",
      "editorGutter.background": "#09090b",
      "scrollbarSlider.background": "#3f3f4680",
      "scrollbarSlider.hoverBackground": "#52525b99",
    },
  })

  registerEffectLanguageProviders(monaco)
}

function editorHeight(value: string, maxHeight: number, editable: boolean) {
  if (editable) {
    return `min(62vh, ${maxHeight}px)`
  }

  const lineCount = value.split("\n").length
  return Math.min(maxHeight, Math.max(220, lineCount * 20 + 32))
}

function markerSeverity(
  monaco: Monaco,
  severity: EffectEditorDiagnostic["severity"]
) {
  switch (severity) {
    case "error":
      return monaco.MarkerSeverity.Error
    case "warning":
      return monaco.MarkerSeverity.Warning
    case "hint":
      return monaco.MarkerSeverity.Hint
    case "info":
    default:
      return monaco.MarkerSeverity.Info
  }
}

function completionKind(monaco: Monaco, kind: string) {
  switch (kind) {
    case "function":
    case "method":
      return monaco.languages.CompletionItemKind.Function
    case "class":
      return monaco.languages.CompletionItemKind.Class
    case "const":
    case "let":
    case "var":
    case "variable":
      return monaco.languages.CompletionItemKind.Variable
    case "module":
      return monaco.languages.CompletionItemKind.Module
    case "property":
      return monaco.languages.CompletionItemKind.Property
    default:
      return monaco.languages.CompletionItemKind.Text
  }
}

function registerEffectLanguageProviders(monaco: Monaco) {
  monaco.languages.registerHoverProvider(languageId, {
    async provideHover(
      model: editor.ITextModel,
      position: { readonly lineNumber: number; readonly column: number }
    ) {
      try {
        const hover = await effectLanguageClient.hover({
          fileName: model.uri.path,
          source: model.getValue(),
          lineNumber: position.lineNumber,
          column: position.column,
        })
        if (!hover) {
          return undefined
        }
        return {
          range: new monaco.Range(
            hover.startLineNumber,
            hover.startColumn,
            hover.endLineNumber,
            hover.endColumn
          ),
          contents: [{ value: `\`\`\`ts\n${hover.text}\n\`\`\`` }],
        }
      } catch {
        return undefined
      }
    },
  })

  monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: [".", '"', "'", "/"],
    async provideCompletionItems(
      model: editor.ITextModel,
      position: { readonly lineNumber: number; readonly column: number }
    ) {
      try {
        const completions = await effectLanguageClient.completions({
          fileName: model.uri.path,
          source: model.getValue(),
          lineNumber: position.lineNumber,
          column: position.column,
        })
        return {
          suggestions: completions.map(completion => ({
            label: completion.label,
            kind: completionKind(monaco, completion.kind),
            insertText: completion.label,
            detail: completion.detail,
          })),
        }
      } catch {
        return { suggestions: [] }
      }
    },
  })
}

function diagnosticsLabel(state: DiagnosticsState) {
  if (state.status === "checking") {
    return "Checking"
  }

  if (state.status === "error") {
    return "Unavailable"
  }

  if (state.diagnostics.length === 0) {
    return "Clear"
  }

  return `${state.diagnostics.length} diagnostic${
    state.diagnostics.length === 1 ? "" : "s"
  }`
}

function DiagnosticsPanel({ state }: { readonly state: DiagnosticsState }) {
  const visibleDiagnostics = state.diagnostics.slice(0, 4)
  const extraDiagnostics = state.diagnostics.length - visibleDiagnostics.length
  const hasDiagnostics = state.diagnostics.length > 0

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          {state.status === "checking" ? (
            <Loader2
              className="size-3.5 animate-spin text-sky-300"
              aria-hidden
            />
          ) : state.status === "error" ? (
            <TriangleAlert className="size-3.5 text-amber-300" aria-hidden />
          ) : hasDiagnostics ? (
            <AlertCircle className="size-3.5 text-red-300" aria-hidden />
          ) : (
            <CheckCircle2 className="size-3.5 text-emerald-300" aria-hidden />
          )}
          <span>Effect LS</span>
          <span className="text-zinc-500">/</span>
          <span>{diagnosticsLabel(state)}</span>
        </div>
        {state.status === "ready" ? (
          <span className="font-mono text-[0.7rem] text-zinc-500">
            {state.durationMs}ms
          </span>
        ) : null}
      </div>
      {state.status === "error" ? (
        <p className="mt-2 text-amber-200">{state.error}</p>
      ) : visibleDiagnostics.length > 0 ? (
        <ul className="mt-2 grid gap-1.5">
          {visibleDiagnostics.map((diagnostic, index) => (
            <li
              key={`${diagnostic.code}-${diagnostic.startLineNumber}-${diagnostic.startColumn}-${index}`}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-2"
            >
              <span className="font-mono text-zinc-500">
                {diagnostic.startLineNumber}:{diagnostic.startColumn}
              </span>
              <span className="min-w-0 truncate">{diagnostic.message}</span>
            </li>
          ))}
          {extraDiagnostics > 0 ? (
            <li className="text-zinc-500">
              {extraDiagnostics} more in editor markers
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

export function CodeViewer({
  value,
  maxHeight = 544,
  ariaLabel = "Code example",
  editable = false,
  fileName = "example.ts",
  onChange,
  diagnostics = editable,
}: {
  readonly value: string
  readonly maxHeight?: number
  readonly ariaLabel?: string
  readonly editable?: boolean
  readonly fileName?: string
  readonly onChange?: (value: string) => void
  readonly diagnostics?: boolean
}) {
  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [diagnosticsState, setDiagnosticsState] = useState<DiagnosticsState>({
    status: "idle",
    diagnostics: [],
  })

  const handleMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    monacoRef.current = monaco
  }

  useEffect(() => {
    if (!editable || !diagnostics) {
      setDiagnosticsState({ status: "idle", diagnostics: [] })
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setDiagnosticsState((current) => ({
        status: "checking",
        diagnostics: current.diagnostics,
      }))

      try {
        const payload = await effectLanguageClient.diagnostics({
          fileName,
          source: value,
        })
        if (controller.signal.aborted) {
          return
        }

        setDiagnosticsState({
          status: "ready",
          diagnostics: payload.diagnostics,
          durationMs: payload.durationMs,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setDiagnosticsState((current) => ({
          status: "error",
          diagnostics: current.diagnostics,
          error: error instanceof Error ? error.message : String(error),
        }))
      }
    }, 350)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [diagnostics, editable, fileName, value])

  useEffect(() => {
    const monaco = monacoRef.current
    const model = editorRef.current?.getModel()

    if (!monaco || !model) {
      return
    }

    const markers: editor.IMarkerData[] = diagnosticsState.diagnostics.map(
      (diagnostic) => ({
        code: diagnostic.code,
        endColumn: diagnostic.endColumn,
        endLineNumber: diagnostic.endLineNumber,
        message: diagnostic.message,
        severity: markerSeverity(monaco, diagnostic.severity),
        source: diagnostic.source,
        startColumn: diagnostic.startColumn,
        startLineNumber: diagnostic.startLineNumber,
      })
    )

    monaco.editor.setModelMarkers(model, "effect-language-service", markers)
  }, [diagnosticsState])

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-zinc-950 shadow-sm dark:border-zinc-800">
      <MonacoEditor
        beforeMount={configureMonaco}
        height={editorHeight(value, maxHeight, editable)}
        language={languageId}
        onChange={(nextValue) => onChange?.(nextValue ?? "")}
        onMount={handleMount}
        path={fileName}
        theme={themeId}
        value={value}
        options={{
          ariaLabel,
          automaticLayout: true,
          contextmenu: editable,
          domReadOnly: !editable,
          folding: false,
          fontFamily:
            "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontLigatures: false,
          fontSize: 12.8,
          glyphMargin: editable,
          lineDecorationsWidth: editable ? 12 : 8,
          lineNumbersMinChars: editable ? 3 : 2,
          minimap: { enabled: false },
          overviewRulerBorder: false,
          overviewRulerLanes: editable ? 2 : 0,
          padding: { top: 14, bottom: 14 },
          readOnly: !editable,
          renderLineHighlight: "none",
          renderValidationDecorations: "on",
          scrollBeyondLastLine: false,
          scrollbar: {
            alwaysConsumeMouseWheel: false,
            horizontalScrollbarSize: 8,
            verticalScrollbarSize: 8,
          },
          smoothScrolling: true,
          wordWrap: "on",
          wrappingIndent: "same",
        }}
      />
      {editable && diagnostics ? (
        <DiagnosticsPanel state={diagnosticsState} />
      ) : null}
    </div>
  )
}
