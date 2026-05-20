import { Option } from "effect"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Tracer from "effect/Tracer"

const maxRuns = 25
const maxSpansPerRun = 600
const maxAttributeLength = 1_200

export interface TraceAttribute {
  readonly key: string
  readonly value: string
}

export interface TraceSpanEvent {
  readonly name: string
  readonly startTimeNanos: string
  readonly relativeStartMs: number
  readonly attributes: ReadonlyArray<TraceAttribute>
}

export interface TraceSpan {
  readonly order: number
  readonly spanId: string
  readonly traceId: string
  readonly parentSpanId?: string
  readonly name: string
  readonly kind: Tracer.SpanKind
  readonly sampled: boolean
  readonly status: "started" | "ended"
  readonly startTimeNanos: string
  readonly endTimeNanos?: string
  readonly relativeStartMs: number
  readonly durationMs?: number
  readonly attributes: ReadonlyArray<TraceAttribute>
  readonly events: ReadonlyArray<TraceSpanEvent>
  readonly error?: string
}

export interface TraceRunSnapshot {
  readonly runId: string
  readonly label: string
  readonly status: "pending" | "running" | "completed"
  readonly startedAt: string
  readonly completedAt?: string
  readonly updatedAt: string
  readonly spans: ReadonlyArray<TraceSpan>
  readonly spanCount: number
  readonly errorCount: number
}

export type TraceStreamEvent =
  | { readonly type: "snapshot"; readonly run: TraceRunSnapshot }
  | { readonly type: "updated"; readonly run: TraceRunSnapshot }
  | { readonly type: "completed"; readonly run: TraceRunSnapshot }

type TraceSubscriber = (event: TraceStreamEvent) => void

interface MutableTraceRun {
  runId: string
  label: string
  status: TraceRunSnapshot["status"]
  startedAt: string
  completedAt?: string
  updatedAt: string
  order: number
  spans: Map<
    string,
    Omit<TraceSpan, "relativeStartMs" | "events"> & {
      events: Array<Omit<TraceSpanEvent, "relativeStartMs">>
    }
  >
}

const runs = new Map<string, MutableTraceRun>()
const subscribers = new Map<string, Set<TraceSubscriber>>()

function trimRuns() {
  while (runs.size > maxRuns) {
    const oldest = runs.keys().next().value
    if (!oldest) return
    runs.delete(oldest)
    subscribers.delete(oldest)
  }
}

function getOrCreateRun(runId: string, label = "Effect run") {
  const existing = runs.get(runId)
  if (existing) {
    if (label !== "Effect run") existing.label = label
    return existing
  }

  const now = new Date().toISOString()
  const run: MutableTraceRun = {
    runId,
    label,
    status: "pending",
    startedAt: now,
    updatedAt: now,
    order: 0,
    spans: new Map(),
  }
  runs.set(runId, run)
  trimRuns()
  return run
}

function truncate(value: string) {
  return value.length <= maxAttributeLength
    ? value
    : `${value.slice(0, maxAttributeLength)}...`
}

function formatTraceValue(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString()
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return truncate(String(value))
  }
  if (value instanceof Error) {
    return truncate(value.stack ?? value.message)
  }

  try {
    return truncate(JSON.stringify(value))
  } catch {
    return truncate(String(value))
  }
}

function attributesFromMap(
  attributes: ReadonlyMap<string, unknown>
): ReadonlyArray<TraceAttribute> {
  return Array.from(attributes.entries())
    .map(([key, value]) => ({ key, value: formatTraceValue(value) }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function attributesFromRecord(
  attributes: Readonly<Record<string, unknown>> | undefined
): ReadonlyArray<TraceAttribute> {
  if (!attributes) return []
  return Object.entries(attributes)
    .map(([key, value]) => ({ key, value: formatTraceValue(value) }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function nanosDurationMs(startTime: bigint, endTime: bigint) {
  return Number(endTime - startTime) / 1_000_000
}

function parentSpanId(parent: Option.Option<Tracer.AnySpan>) {
  return Option.isSome(parent) ? parent.value.spanId : undefined
}

function spanError(span: Tracer.Span) {
  if (span.status._tag !== "Ended") return undefined
  if (!Exit.isFailure(span.status.exit)) return undefined
  return Cause.pretty(span.status.exit.cause)
}

function snapshotRun(run: MutableTraceRun): TraceRunSnapshot {
  const rawSpans = Array.from(run.spans.values()).sort(
    (left, right) => left.order - right.order
  )
  const firstStart = rawSpans.reduce<bigint | undefined>((current, span) => {
    const next = BigInt(span.startTimeNanos)
    return current === undefined || next < current ? next : current
  }, undefined)

  const spans = rawSpans.map((span) => {
    const start = BigInt(span.startTimeNanos)
    return {
      ...span,
      relativeStartMs:
        firstStart === undefined ? 0 : Number(start - firstStart) / 1_000_000,
      events: span.events.map((event) => ({
        ...event,
        relativeStartMs:
          firstStart === undefined
            ? 0
            : Number(BigInt(event.startTimeNanos) - firstStart) / 1_000_000,
      })),
    }
  })

  return {
    runId: run.runId,
    label: run.label,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
    spans,
    spanCount: spans.length,
    errorCount: spans.filter((span) => span.error).length,
  }
}

function emit(runId: string, type: TraceStreamEvent["type"]) {
  const run = runs.get(runId)
  if (!run) return
  const event = { type, run: snapshotRun(run) } as TraceStreamEvent
  subscribers.get(runId)?.forEach((subscriber) => subscriber(event))
}

export function startTraceRun(runId: string, label: string) {
  const run = getOrCreateRun(runId, label)
  const now = new Date().toISOString()
  run.status = "running"
  run.startedAt = now
  run.updatedAt = now
  run.completedAt = undefined
  run.spans.clear()
  run.order = 0
  emit(runId, "updated")
}

export function completeTraceRun(runId: string) {
  const run = getOrCreateRun(runId)
  const now = new Date().toISOString()
  run.status = "completed"
  run.completedAt = now
  run.updatedAt = now
  emit(runId, "completed")
}

export function getTraceRun(runId: string) {
  return snapshotRun(getOrCreateRun(runId))
}

export function subscribeTraceRun(runId: string, subscriber: TraceSubscriber) {
  let set = subscribers.get(runId)
  if (!set) {
    set = new Set()
    subscribers.set(runId, set)
  }
  set.add(subscriber)
  subscriber({ type: "snapshot", run: getTraceRun(runId) })

  return () => {
    const current = subscribers.get(runId)
    current?.delete(subscriber)
    if (current?.size === 0) {
      subscribers.delete(runId)
    }
  }
}

function recordSpan(runId: string, span: Tracer.Span) {
  const run = getOrCreateRun(runId)
  const existing = run.spans.get(span.spanId)
  const startTime = span.status.startTime
  const endTime = span.status._tag === "Ended" ? span.status.endTime : undefined

  if (!existing && run.spans.size >= maxSpansPerRun) {
    return
  }

  run.spans.set(span.spanId, {
    order: existing?.order ?? run.order++,
    spanId: span.spanId,
    traceId: span.traceId,
    parentSpanId: parentSpanId(span.parent),
    name: span.name,
    kind: span.kind,
    sampled: span.sampled,
    status: span.status._tag === "Ended" ? "ended" : "started",
    startTimeNanos: startTime.toString(),
    endTimeNanos: endTime?.toString(),
    durationMs: endTime ? nanosDurationMs(startTime, endTime) : undefined,
    attributes: attributesFromMap(span.attributes),
    events: existing?.events ?? [],
    error: spanError(span),
  })

  run.updatedAt = new Date().toISOString()
  emit(runId, "updated")
}

function recordSpanEvent(
  runId: string,
  span: Tracer.Span,
  name: string,
  startTime: bigint,
  attributes?: Readonly<Record<string, unknown>>
) {
  const run = getOrCreateRun(runId)
  const existing = run.spans.get(span.spanId)
  if (!existing) {
    recordSpan(runId, span)
  }
  const current = run.spans.get(span.spanId)
  if (!current) return

  current.events.push({
    name,
    startTimeNanos: startTime.toString(),
    attributes: attributesFromRecord(attributes),
  })
  run.updatedAt = new Date().toISOString()
  emit(runId, "updated")
}

export function makeTraceCollectorTracer(
  runId: string,
  delegate: Tracer.Tracer
) {
  return Tracer.make({
    span(name, parent, context, links, startTime, kind, options) {
      const span = delegate.span(
        name,
        parent,
        context,
        links,
        startTime,
        kind,
        options
      )
      const originalAttribute = span.attribute.bind(span)
      const originalEvent = span.event.bind(span)
      const originalEnd = span.end.bind(span)
      const originalAddLinks = span.addLinks.bind(span)

      span.attribute = (key, value) => {
        originalAttribute(key, value)
        recordSpan(runId, span)
      }
      span.event = (eventName, eventStartTime, attributes) => {
        originalEvent(eventName, eventStartTime, attributes)
        recordSpanEvent(runId, span, eventName, eventStartTime, attributes)
      }
      span.addLinks = (nextLinks) => {
        originalAddLinks(nextLinks)
        recordSpan(runId, span)
      }
      span.end = (endTime, exit) => {
        originalEnd(endTime, exit)
        recordSpan(runId, span)
      }

      recordSpan(runId, span)
      return span
    },
    context: (evaluate, fiber) => delegate.context(evaluate, fiber),
  })
}
