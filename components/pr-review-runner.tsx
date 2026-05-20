"use client"

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  GitPullRequest,
  Loader2,
  Play,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CodeViewer } from "@/components/code-viewer"
import { EffectTraceViewer } from "@/components/effect-trace-viewer"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  prReviewEffectCode,
  type PrReviewFormInput,
} from "@/lib/pr-review-code"
import type { TraceRunSnapshot, TraceStreamEvent } from "@/lib/effect-traces"

interface PrReviewRunResult {
  readonly repository: string
  readonly pullRequestId: string
  readonly triggerId: string
  readonly baseUrl: string
  readonly durationMs: number
  readonly rebuiltSandboxScript: boolean
  readonly purgedJobs: ReadonlyArray<{
    readonly jobKey: string | null
    readonly status: string | null
    readonly headSha: string | null
  }>
  readonly botResponse: {
    readonly status: number
    readonly statusText: string
    readonly body: string | null
  }
  readonly output: string
}

type RunState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "success"; readonly result: PrReviewRunResult }
  | { readonly status: "error"; readonly error: string; readonly hint?: string }

function createRunId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

async function startPrReview(input: PrReviewFormInput, runId: string) {
  const response = await fetch(
    `/api/pr-review/run?runId=${encodeURIComponent(runId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-effect-trace-run-id": runId,
      },
      body: JSON.stringify({ ...input, runId }),
    }
  )
  const payload = (await response.json()) as
    | { readonly success: true; readonly result: PrReviewRunResult }
    | {
        readonly success: false
        readonly error: string
        readonly hint?: string
      }

  if (payload.success) {
    return payload.result
  }

  throw Object.assign(new Error(payload.error), { hint: payload.hint })
}

function ResultPanel({
  state,
  traceRun,
}: {
  readonly state: RunState
  readonly traceRun?: TraceRunSnapshot
}) {
  if (state.status === "idle") {
    return (
      <div className="rounded-lg border border-dashed bg-background p-3 text-sm leading-6 text-muted-foreground">
        Submit a PR selector to trigger the same local bot review flow as{" "}
        <code>npm run trigger:bot</code>.
      </div>
    )
  }

  if (state.status === "running") {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex items-start gap-2 rounded-lg border bg-background p-3 text-sm text-muted-foreground">
          <Loader2
            className="mt-0.5 size-4 shrink-0 animate-spin"
            aria-hidden
          />
          <span>Running the PR comment bot Effect program.</span>
        </div>
        <EffectTraceViewer run={traceRun} />
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-3">
        <Alert variant="destructive" className="rounded-lg">
          <AlertCircle className="size-4" aria-hidden />
          <AlertTitle>PR comment bot failed</AlertTitle>
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
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className="rounded-md text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="mr-1 size-3" aria-hidden />
          Started
        </Badge>
        <Badge variant="outline" className="rounded-md">
          <Clock className="mr-1 size-3" aria-hidden />
          {state.result.durationMs}ms
        </Badge>
        <Badge variant="outline" className="rounded-md">
          HTTP {state.result.botResponse.status}
        </Badge>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {[
          ["Repository", state.result.repository],
          ["Pull request", `#${state.result.pullRequestId}`],
          ["Trigger ID", state.result.triggerId],
          ["Bot API", state.result.baseUrl],
          ["Rebuilt script", state.result.rebuiltSandboxScript ? "yes" : "no"],
          ["Purged jobs", String(state.result.purgedJobs.length)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-md border bg-background p-2"
          >
            <dt className="text-xs font-medium text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-1 font-mono text-xs break-words">{value}</dd>
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
        </TabsList>
        <TabsContent value="trace">
          <EffectTraceViewer run={traceRun} />
        </TabsContent>
        <TabsContent value="output">
          <pre className="max-h-96 max-w-full overflow-auto rounded-lg border bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-50 shadow-sm dark:border-zinc-800">
            <code>{state.result.output}</code>
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function PrReviewRunner() {
  const [prSelector, setPrSelector] = useState("replayio/ExampleApps#3")
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:4317")
  const [triggerId, setTriggerId] = useState(
    () => `local-effect-pr-review-${Date.now()}`
  )
  const [rebuildSandboxScript, setRebuildSandboxScript] = useState(true)
  const [purgeExistingJobs, setPurgeExistingJobs] = useState(true)
  const [state, setState] = useState<RunState>({ status: "idle" })
  const [traceRun, setTraceRun] = useState<TraceRunSnapshot | undefined>()
  const traceStreamRef = useRef<EventSource | undefined>(undefined)

  const input = useMemo(
    () => ({
      prSelector,
      baseUrl,
      triggerId,
      rebuildSandboxScript,
      purgeExistingJobs,
    }),
    [baseUrl, prSelector, purgeExistingJobs, rebuildSandboxScript, triggerId]
  )

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const runId = createRunId()
    setState({ status: "running" })
    setTraceRun(undefined)
    const stream = openTraceStream(runId)

    try {
      const result = await startPrReview(input, runId)
      setState({ status: "success", result })
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        hint:
          typeof error === "object" && error !== null && "hint" in error
            ? String(error.hint)
            : undefined,
      })
    } finally {
      window.setTimeout(() => {
        stream.close()
      }, 500)
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.48fr)_minmax(0,1fr)]">
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitPullRequest
              className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
              aria-hidden
            />
            PR comment bot trigger
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-3" onSubmit={handleSubmit}>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">PR selector</span>
              <input
                value={prSelector}
                onChange={(event) => setPrSelector(event.target.value)}
                placeholder="owner/repo#123"
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Bot base URL</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://127.0.0.1:4317"
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Trigger ID</span>
              <input
                value={triggerId}
                onChange={(event) => setTriggerId(event.target.value)}
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </label>
            <div className="grid gap-2 text-sm">
              <label className="flex items-start gap-2 rounded-lg border bg-background p-3">
                <input
                  type="checkbox"
                  checked={rebuildSandboxScript}
                  onChange={(event) =>
                    setRebuildSandboxScript(event.target.checked)
                  }
                  className="mt-1 size-4"
                />
                <span className="min-w-0">Rebuild sandbox Sprite script</span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border bg-background p-3">
                <input
                  type="checkbox"
                  checked={purgeExistingJobs}
                  onChange={(event) =>
                    setPurgeExistingJobs(event.target.checked)
                  }
                  className="mt-1 size-4"
                />
                <span className="min-w-0">Purge existing sandbox jobs</span>
              </label>
            </div>
            <Button
              type="submit"
              disabled={state.status === "running" || !prSelector.trim()}
              className="w-full gap-2 sm:w-auto"
            >
              {state.status === "running" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              Start PR comment bot
            </Button>
          </form>
          <ResultPanel state={state} traceRun={traceRun} />
        </CardContent>
      </Card>
      <div className="min-w-0 space-y-2">
        <div className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Effect code
        </div>
        <CodeViewer
          value={prReviewEffectCode(input)}
          maxHeight={680}
          ariaLabel="PR review Effect source"
        />
      </div>
    </div>
  )
}
