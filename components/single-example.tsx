"use client"

import {
  AlertCircle,
  Activity,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  RotateCcw,
  Server,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { CodeViewer } from "@/components/code-viewer"
import { EffectTraceViewer } from "@/components/effect-trace-viewer"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { browserEffectRuntime } from "@/lib/browser-effect-runtime"
import { codeExamples, type ExampleId } from "@/lib/sprite-doc-content"
import type { TraceRunSnapshot, TraceStreamEvent } from "@/lib/effect-traces"

type Example = (typeof codeExamples)[number]

type RunResult = {
  readonly example: ExampleId
  readonly runId: string
  readonly spriteName: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly output: string
  readonly previewUrl?: string
  readonly previewTitle?: string
  readonly details: ReadonlyArray<{
    readonly label: string
    readonly value: string
  }>
}

type RunState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "success"; readonly result: RunResult }
  | { readonly status: "error"; readonly error: string; readonly hint?: string }

function createRunId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function runExample(example: ExampleId, runId: string) {
  const response = await fetch(
    `/api/examples/run?runId=${encodeURIComponent(runId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-effect-trace-run-id": runId,
      },
      body: JSON.stringify({ example, runId }),
    }
  )
  const payload = (await response.json()) as
    | { success: true; result: RunResult }
    | { success: false; error: string; hint?: string }

  if (payload.success) return payload.result
  throw Object.assign(new Error(payload.error), { hint: payload.hint })
}

function OutputPre({ output }: { readonly output: string }) {
  return (
    <pre className="max-h-80 max-w-full overflow-auto rounded-lg border bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-50 shadow-sm sm:p-4 sm:text-[0.8rem] dark:border-zinc-800">
      <code>{output}</code>
    </pre>
  )
}

function PreviewFrame({ result }: { readonly result: RunResult }) {
  if (!result.previewUrl) {
    return null
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <Badge variant="secondary" className="rounded-md">
          {result.previewTitle ?? "Preview"}
        </Badge>
        <a
          href={result.previewUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({
            variant: "outline",
            size: "sm",
            className: "h-8 gap-2",
          })}
        >
          <ExternalLink className="size-3.5" aria-hidden />
          Open
        </a>
      </div>
      <iframe
        src={result.previewUrl}
        title={result.previewTitle ?? "Sprite preview"}
        className="h-[65vh] min-h-80 w-full border-0 bg-background md:h-[36rem]"
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
      />
    </div>
  )
}

function RunOutput({
  state,
  traceRun,
}: {
  readonly state: RunState
  readonly traceRun?: TraceRunSnapshot
}) {
  if (state.status === "idle") {
    return (
      <div className="rounded-lg border border-dashed bg-background p-3 text-sm text-pretty text-muted-foreground sm:p-4">
        Run this example to execute it and see output here.
      </div>
    )
  }

  if (state.status === "running") {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-3 sm:p-4">
        <div className="flex items-start gap-2 rounded-lg border bg-background p-3 text-sm text-pretty text-muted-foreground sm:items-center sm:p-4">
          <Loader2
            className="mt-0.5 size-4 shrink-0 animate-spin sm:mt-0"
            aria-hidden
          />
          <span>
            Preparing the runtime and running the Effect program.
          </span>
        </div>
        <EffectTraceViewer run={traceRun} />
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-3 sm:p-4">
        <Alert variant="destructive" className="rounded-lg">
          <AlertCircle className="size-4" aria-hidden />
          <AlertTitle>Run failed</AlertTitle>
          <AlertDescription>
            <p>{state.error}</p>
            {state.hint ? <p className="mt-2">{state.hint}</p> : null}
          </AlertDescription>
        </Alert>
        <EffectTraceViewer run={traceRun} />
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className="rounded-md text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="mr-1 size-3" aria-hidden />
          Completed
        </Badge>
        <Badge variant="outline" className="rounded-md">
          <Clock className="mr-1 size-3" aria-hidden />
          {state.result.durationMs}ms
        </Badge>
        <Badge variant="outline" className="rounded-md">
          <Server className="mr-1 size-3" aria-hidden />
          <span className="max-w-44 truncate sm:max-w-none">
            {state.result.spriteName}
          </span>
        </Badge>
      </div>
      <dl className="grid gap-2 text-sm md:grid-cols-2">
        {state.result.details.map((detail) => (
          <div
            key={detail.label}
            className="min-w-0 rounded-md border bg-background p-2"
          >
            <dt className="text-xs font-medium text-muted-foreground">
              {detail.label}
            </dt>
            <dd className="mt-1 font-mono text-xs break-words">
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
      <Tabs defaultValue="trace" className="min-w-0">
        <TabsList>
          <TabsTrigger value="trace">
            <Activity className="size-3.5" aria-hidden />
            Trace
          </TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
          {state.result.previewUrl ? (
            <TabsTrigger value="preview">Preview</TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="trace">
          <EffectTraceViewer run={traceRun} />
        </TabsContent>
        <TabsContent value="output">
          <OutputPre output={state.result.output} />
        </TabsContent>
        {state.result.previewUrl ? (
          <TabsContent value="preview">
            <PreviewFrame result={state.result} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}

export function SingleExampleRunner({ example }: { example: Example }) {
  const [state, setState] = useState<RunState>({ status: "idle" })
  const [source, setSource] = useState<string>(example.code)
  const [traceRun, setTraceRun] = useState<TraceRunSnapshot | undefined>()
  const traceStreamRef = useRef<EventSource | undefined>(undefined)
  const isEdited = source !== example.code
  const runsInBrowser = browserEffectRuntime.canRun(example.value)

  useEffect(() => {
    return () => {
      traceStreamRef.current?.close()
    }
  }, [])

  function openTraceStream(runId: string) {
    traceStreamRef.current?.close()
    const stream = new EventSource(
      `/api/traces/${encodeURIComponent(runId)}/stream`
    )
    const onTraceEvent = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as TraceStreamEvent
      setTraceRun(payload.run)
    }

    stream.addEventListener("snapshot", onTraceEvent)
    stream.addEventListener("updated", onTraceEvent)
    stream.addEventListener("completed", onTraceEvent)
    traceStreamRef.current = stream
    return stream
  }

  async function handleRun() {
    const runId = createRunId()
    setState({ status: "running" })
    setTraceRun(undefined)
    const stream = runsInBrowser ? undefined : openTraceStream(runId)

    try {
      const result = runsInBrowser
        ? await browserEffectRuntime.run({
            exampleId: example.value,
            fileName: `${example.value}.ts`,
            runId,
            source,
          })
        : await runExample(example.value, runId)
      setState({ status: "success", result })
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        hint:
          typeof error === "object" && error !== null && "hint" in error
            ? String((error as { hint?: unknown }).hint)
            : undefined,
      })
    } finally {
      window.setTimeout(() => {
        stream?.close()
      }, 500)
    }
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.55fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <Alert className="rounded-lg border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30">
          <Play
            className="size-4 text-emerald-700 dark:text-emerald-300"
            aria-hidden
          />
          <AlertTitle>{example.title}</AlertTitle>
          <AlertDescription>{example.description}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={handleRun}
            disabled={state.status === "running"}
            className="w-full gap-2 sm:w-auto"
          >
            {state.status === "running" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {isEdited ? "Run edited" : "Run original"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSource(example.code)}
            disabled={!isEdited}
            className="w-full gap-2 sm:w-auto"
          >
            <RotateCcw className="size-4" aria-hidden />
            Reset
          </Button>
          {isEdited ? (
            <Badge variant="outline" className="rounded-md">
              Edited
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <CodeViewer
          editable
          fileName={`${example.value}.ts`}
          onChange={setSource}
          value={source}
          ariaLabel={`${example.title} source`}
        />
        <RunOutput state={state} traceRun={traceRun} />
      </div>
    </div>
  )
}
