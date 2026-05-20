"use client"

import {
  AlertTriangle,
  CheckCircle2,
  CircleDotDashed,
  Clock3,
  Layers3,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import type { TraceRunSnapshot, TraceSpan } from "@/lib/effect-traces"

interface TraceRow extends TraceSpan {
  readonly depth: number
}

function formatMs(value?: number) {
  if (value === undefined) return "running"
  if (value < 1) return `${value.toFixed(2)}ms`
  if (value < 1_000) return `${value.toFixed(1)}ms`
  return `${(value / 1_000).toFixed(2)}s`
}

function buildRows(spans: ReadonlyArray<TraceSpan>) {
  const byParent = new Map<string | undefined, TraceSpan[]>()
  for (const span of spans) {
    const siblings = byParent.get(span.parentSpanId) ?? []
    siblings.push(span)
    byParent.set(span.parentSpanId, siblings)
  }

  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.order - right.order)
  }

  const rows: TraceRow[] = []
  const visit = (span: TraceSpan, depth: number) => {
    rows.push({ ...span, depth })
    for (const child of byParent.get(span.spanId) ?? []) {
      visit(child, depth + 1)
    }
  }

  for (const root of byParent.get(undefined) ?? []) {
    visit(root, 0)
  }

  return rows
}

function spanEnd(span: TraceSpan) {
  return span.relativeStartMs + (span.durationMs ?? 1)
}

function TraceBar({
  span,
  totalMs,
}: {
  readonly span: TraceSpan
  readonly totalMs: number
}) {
  const left = Math.max(0, (span.relativeStartMs / totalMs) * 100)
  const width = Math.max(1.5, ((span.durationMs ?? 1) / totalMs) * 100)

  return (
    <div className="relative h-2 min-w-24 flex-1 overflow-hidden rounded bg-muted">
      <div
        className={
          span.error
            ? "absolute inset-y-0 rounded bg-destructive"
            : span.status === "ended"
              ? "absolute inset-y-0 rounded bg-emerald-500"
              : "absolute inset-y-0 rounded bg-sky-500"
        }
        style={{
          left: `${left}%`,
          width: `${Math.min(width, 100 - left)}%`,
        }}
      />
    </div>
  )
}

function AttributeList({
  attributes,
}: {
  readonly attributes: TraceSpan["attributes"]
}) {
  if (attributes.length === 0) {
    return <div className="text-sm text-muted-foreground">No attributes</div>
  }

  return (
    <dl className="space-y-2">
      {attributes.map((attribute) => (
        <div key={attribute.key} className="min-w-0 rounded-md border p-2">
          <dt className="text-xs font-medium text-muted-foreground">
            {attribute.key}
          </dt>
          <dd className="mt-1 font-mono text-xs break-words">
            {attribute.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function SpanDetails({ span }: { readonly span?: TraceSpan }) {
  if (!span) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Select a span to inspect its attributes and events.
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {span.error ? (
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
          ) : span.status === "ended" ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          ) : (
            <CircleDotDashed className="size-4 shrink-0 text-sky-600" />
          )}
          <div className="truncate text-sm font-medium">{span.name}</div>
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          <Badge variant="outline" className="rounded-md">
            {formatMs(span.durationMs)}
          </Badge>
          <Badge variant="outline" className="rounded-md">
            {span.kind}
          </Badge>
        </div>
      </div>

      {span.error ? (
        <pre className="max-h-48 overflow-auto rounded-md border bg-destructive/10 p-2 text-xs text-destructive">
          <code>{span.error}</code>
        </pre>
      ) : null}

      <div className="space-y-2">
        <div className="text-xs font-medium tracking-normal text-muted-foreground uppercase">
          Attributes
        </div>
        <AttributeList attributes={span.attributes} />
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium tracking-normal text-muted-foreground uppercase">
          Events
        </div>
        {span.events.length === 0 ? (
          <div className="text-sm text-muted-foreground">No events</div>
        ) : (
          <div className="space-y-2">
            {span.events.map((event, index) => (
              <div
                key={`${event.name}-${index}`}
                className="rounded-md border p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium">
                    {event.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    +{formatMs(event.relativeStartMs)}
                  </div>
                </div>
                <AttributeList attributes={event.attributes} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function EffectTraceViewer({
  run,
}: {
  readonly run?: TraceRunSnapshot
}) {
  const rows = useMemo(() => buildRows(run?.spans ?? []), [run?.spans])
  const [selectedSpanId, setSelectedSpanId] = useState<string | undefined>()
  const selectedSpan =
    rows.find((span) => span.spanId === selectedSpanId) ?? rows[0]
  const currentSelectedSpanId = selectedSpan?.spanId
  const totalMs = Math.max(1, ...rows.map(spanEnd))

  if (!run || run.spans.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-background p-4 text-sm text-muted-foreground">
        Trace spans will appear here as soon as the Effect program starts.
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="rounded-md">
          <Layers3 className="mr-1 size-3" aria-hidden />
          {run.spanCount} spans
        </Badge>
        <Badge
          variant={run.errorCount > 0 ? "destructive" : "outline"}
          className="rounded-md"
        >
          {run.errorCount} errors
        </Badge>
        <Badge variant="outline" className="rounded-md">
          <Clock3 className="mr-1 size-3" aria-hidden />
          {run.status}
        </Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.38fr)]">
        <div className="max-h-[32rem] overflow-auto rounded-lg border">
          {rows.map((span) => (
            <button
              key={span.spanId}
              type="button"
              onClick={() => setSelectedSpanId(span.spanId)}
              className={`flex w-full min-w-0 items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60 ${
                currentSelectedSpanId === span.spanId
                  ? "bg-muted"
                  : "bg-background"
              }`}
            >
              <div
                className="min-w-0 flex-1"
                style={{ paddingLeft: `${span.depth * 14}px` }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={
                      span.error
                        ? "size-2 shrink-0 rounded-full bg-destructive"
                        : span.status === "ended"
                          ? "size-2 shrink-0 rounded-full bg-emerald-500"
                          : "size-2 shrink-0 rounded-full bg-sky-500"
                    }
                  />
                  <span className="truncate text-sm font-medium">
                    {span.name}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  +{formatMs(span.relativeStartMs)} ·{" "}
                  {formatMs(span.durationMs)}
                </div>
              </div>
              <TraceBar span={span} totalMs={totalMs} />
            </button>
          ))}
        </div>

        <SpanDetails span={selectedSpan} />
      </div>
    </div>
  )
}
