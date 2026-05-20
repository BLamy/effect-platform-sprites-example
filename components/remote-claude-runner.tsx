"use client"

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  Terminal,
} from "lucide-react"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { CodeViewer } from "@/components/code-viewer"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AGENT_CLI_DEFAULT_VERSIONS,
  agentOptions,
  getAgentSpec,
  remoteAgentEffectCode,
  type AgentId,
  type AgentSessionMode,
} from "@/lib/remote-agent-code"

interface AgentSessionResult {
  readonly agentId: AgentId
  readonly agentLabel: string
  readonly mode: AgentSessionMode
  readonly status: "completed" | "started"
  readonly spriteName: string
  readonly sessionId?: string
  readonly command: string
  readonly tty: boolean
  readonly durationMs?: number
  readonly exitCode?: number
  readonly output?: string
  readonly terminalUrl?: string
}

type RunState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "success"; readonly result: AgentSessionResult }
  | { readonly status: "error"; readonly error: string }

interface RunnerProps {
  readonly defaultAgentId?: AgentId
}

async function createAgentSession(input: {
  readonly agentId: AgentId
  readonly mode: AgentSessionMode
  readonly prompt?: string
  readonly cols?: number
  readonly rows?: number
}) {
  const response = await fetch("/api/agents/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const payload = (await response.json()) as
    | { readonly success: true; readonly result: AgentSessionResult }
    | { readonly success: false; readonly error: string }

  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? response.statusText : payload.error)
  }

  return payload.result
}

function printEffectCode(agentId: AgentId, prompt: string) {
  return remoteAgentEffectCode({
    agentId,
    mode: "print",
    prompt,
    cliVersion: AGENT_CLI_DEFAULT_VERSIONS[agentId],
    cols: 100,
    rows: 30,
  })
}

function interactiveEffectCode(
  agentId: AgentId,
  cols: number,
  rows: number
) {
  return remoteAgentEffectCode({
    agentId,
    mode: "interactive",
    cliVersion: AGENT_CLI_DEFAULT_VERSIONS[agentId],
    cols,
    rows,
  })
}

function AgentSelect({
  agentId,
  onAgentIdChange,
}: {
  readonly agentId: AgentId
  readonly onAgentIdChange: (agentId: AgentId) => void
}) {
  return (
    <label className="grid gap-1.5 text-sm sm:max-w-xs">
      <span className="font-medium">Agent</span>
      <select
        value={agentId}
        onChange={(event) => onAgentIdChange(event.target.value as AgentId)}
        className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {agentOptions.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ResultDetails({ result }: { readonly result: AgentSessionResult }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div className="min-w-0 rounded-md border bg-background p-2">
        <dt className="text-xs font-medium text-muted-foreground">Agent</dt>
        <dd className="mt-1 font-mono text-xs break-words">
          {result.agentLabel}
        </dd>
      </div>
      <div className="min-w-0 rounded-md border bg-background p-2">
        <dt className="text-xs font-medium text-muted-foreground">Sprite</dt>
        <dd className="mt-1 font-mono text-xs break-words">
          {result.spriteName}
        </dd>
      </div>
      <div className="min-w-0 rounded-md border bg-background p-2">
        <dt className="text-xs font-medium text-muted-foreground">Command</dt>
        <dd className="mt-1 font-mono text-xs break-words">{result.command}</dd>
      </div>
      {result.sessionId ? (
        <div className="min-w-0 rounded-md border bg-background p-2">
          <dt className="text-xs font-medium text-muted-foreground">Session</dt>
          <dd className="mt-1 font-mono text-xs break-words">
            {result.sessionId}
          </dd>
        </div>
      ) : null}
      {typeof result.durationMs === "number" ? (
        <div className="min-w-0 rounded-md border bg-background p-2">
          <dt className="text-xs font-medium text-muted-foreground">
            Duration
          </dt>
          <dd className="mt-1 font-mono text-xs">{result.durationMs}ms</dd>
        </div>
      ) : null}
    </dl>
  )
}

function RunStatus({ state }: { readonly state: RunState }) {
  if (state.status === "idle") return null

  if (state.status === "running") {
    return (
      <div className="flex items-start gap-2 rounded-lg border bg-background p-3 text-sm text-muted-foreground">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
        <span>Starting the remote agent session.</span>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <Alert variant="destructive" className="rounded-lg">
        <AlertCircle className="size-4" aria-hidden />
        <AlertTitle>Agent session failed</AlertTitle>
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="rounded-md">
          <CheckCircle2 className="mr-1 size-3" aria-hidden />
          {state.result.status === "completed" ? "Completed" : "Started"}
        </Badge>
        <Badge variant="outline" className="rounded-md">
          {state.result.agentLabel}
        </Badge>
        {typeof state.result.exitCode === "number" ? (
          <Badge variant="outline" className="rounded-md">
            exit {state.result.exitCode}
          </Badge>
        ) : null}
        {typeof state.result.durationMs === "number" ? (
          <Badge variant="outline" className="rounded-md">
            <Clock className="mr-1 size-3" aria-hidden />
            {state.result.durationMs}ms
          </Badge>
        ) : null}
      </div>
      <ResultDetails result={state.result} />
      {state.result.output ? (
        <pre className="max-h-80 max-w-full overflow-auto rounded-lg border bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-50 shadow-sm dark:border-zinc-800">
          <code>{state.result.output}</code>
        </pre>
      ) : null}
    </div>
  )
}

export function AgentPrintRunner({ defaultAgentId = "codex" }: RunnerProps) {
  const [agentId, setAgentId] = useState<AgentId>(defaultAgentId)
  const [printPrompt, setPrintPrompt] = useState(
    "Say hello from a remote Sprite and print the current working directory."
  )
  const [printState, setPrintState] = useState<RunState>({ status: "idle" })
  const spec = getAgentSpec(agentId)

  async function runPrint() {
    setPrintState({ status: "running" })
    try {
      const result = await createAgentSession({
        agentId,
        mode: "print",
        prompt: printPrompt,
      })
      setPrintState({ status: "success", result })
    } catch (error) {
      setPrintState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play
            className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
            aria-hidden
          />
          One-shot agent command
        </CardTitle>
        <CardDescription>
          Runs a non-interactive AI CLI command in a remote Sprite and returns
          the output.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <AgentSelect agentId={agentId} onAgentIdChange={setAgentId} />
        <textarea
          value={printPrompt}
          onChange={(event) => setPrintPrompt(event.target.value)}
          className="min-h-28 w-full resize-y rounded-lg border bg-background p-3 text-sm leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`${spec.commandLabel} prompt`}
        />
        <Button
          type="button"
          onClick={runPrint}
          disabled={printState.status === "running" || !printPrompt.trim()}
          className="w-full gap-2 sm:w-auto"
        >
          {printState.status === "running" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
          Run {spec.commandLabel}
        </Button>
        <RunStatus state={printState} />
        <div className="space-y-2">
          <div className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Effect code
          </div>
          <CodeViewer
            value={printEffectCode(agentId, printPrompt)}
            maxHeight={420}
            ariaLabel={`${spec.commandLabel} Effect source`}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function AgentInteractiveRunner({
  defaultAgentId = "codex",
}: RunnerProps) {
  const [agentId, setAgentId] = useState<AgentId>(defaultAgentId)
  const [interactiveCols, setInteractiveCols] = useState(100)
  const [interactiveRows, setInteractiveRows] = useState(30)
  const [interactiveState, setInteractiveState] = useState<RunState>({
    status: "idle",
  })
  const spec = getAgentSpec(agentId)

  async function runInteractive() {
    setInteractiveState({ status: "running" })
    try {
      const result = await createAgentSession({
        agentId,
        mode: "interactive",
        cols: interactiveCols,
        rows: interactiveRows,
      })
      setInteractiveState({ status: "success", result })
    } catch (error) {
      setInteractiveState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const interactiveResult =
    interactiveState.status === "success" ? interactiveState.result : undefined

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal
            className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
            aria-hidden
          />
          Interactive agent terminal
        </CardTitle>
        <CardDescription>
          Starts an AI CLI in a remote Sprite TTY and renders it with
          ghostty-web.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <AgentSelect agentId={agentId} onAgentIdChange={setAgentId} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={runInteractive}
            disabled={interactiveState.status === "running"}
            className="w-full gap-2 sm:w-auto"
          >
            {interactiveState.status === "running" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Terminal className="size-4" aria-hidden />
            )}
            Start {spec.label}
          </Button>
          {interactiveResult?.terminalUrl ? (
            <a
              href={interactiveResult.terminalUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({
                variant: "outline",
                className: "w-full gap-2 sm:w-auto",
              })}
            >
              <ExternalLink className="size-4" aria-hidden />
              Open terminal
            </a>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Columns</span>
            <input
              type="number"
              min={40}
              max={240}
              value={interactiveCols}
              onChange={(event) =>
                setInteractiveCols(Number(event.target.value))
              }
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Rows</span>
            <input
              type="number"
              min={10}
              max={80}
              value={interactiveRows}
              onChange={(event) =>
                setInteractiveRows(Number(event.target.value))
              }
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Effect code
          </div>
          <CodeViewer
            value={interactiveEffectCode(
              agentId,
              interactiveCols,
              interactiveRows
            )}
            maxHeight={420}
            ariaLabel={`Interactive ${spec.label} Effect source`}
          />
        </div>
        <RunStatus state={interactiveState} />
        {interactiveResult?.terminalUrl ? (
          <div className="overflow-hidden rounded-lg border bg-background">
            <iframe
              src={interactiveResult.terminalUrl}
              title={`Interactive ${interactiveResult.agentLabel} terminal`}
              className="h-[70vh] min-h-96 w-full border-0"
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ClaudePrintRunner() {
  return <AgentPrintRunner defaultAgentId="claude" />
}

export function ClaudeInteractiveRunner() {
  return <AgentInteractiveRunner defaultAgentId="claude" />
}
