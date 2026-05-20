import { DevTools } from "@effect/experimental"
import { Effect, Layer } from "effect"

import {
  completeTraceRun,
  makeTraceCollectorTracer,
  startTraceRun,
} from "@/lib/effect-traces"

function devToolsFlag() {
  return process.env.EFFECT_DEVTOOLS?.trim().toLowerCase()
}

export function isDevToolsEnabled() {
  const flag = devToolsFlag()
  if (flag === "false" || flag === "0" || flag === "off" || flag === "no") {
    return false
  }
  return flag === "1" || flag === "true" || flag === "yes"
}

export function devToolsWebSocketUrl() {
  const url = process.env.EFFECT_DEVTOOLS_URL?.trim()
  return url && url.length > 0 ? url : "ws://localhost:34437"
}

/**
 * DevTools layer for the Next.js server process.
 * Set `EFFECT_DEVTOOLS=true` in `.env.local` while the Effect Dev Tools
 * extension backend is listening (default `ws://localhost:34437`).
 */
export function devToolsLayer(): Layer.Layer<never> | undefined {
  if (!isDevToolsEnabled()) {
    return undefined
  }

  return DevTools.layer(devToolsWebSocketUrl())
}

let devToolsFiberStarted = false

/**
 * Keeps the DevTools websocket and patched tracer alive for the Node process.
 * Called from `instrumentation.ts` on server boot.
 */
export async function ensureDevTools() {
  if (devToolsFiberStarted || !isDevToolsEnabled()) {
    return
  }

  const layer = devToolsLayer()
  if (!layer) {
    return
  }

  devToolsFiberStarted = true

  Effect.runFork(
    Effect.gen(function* () {
      yield* Effect.logInfo("Effect DevTools connected for docs app server", {
        url: devToolsWebSocketUrl(),
      })
      yield* Effect.never
    }).pipe(Effect.provide(layer), Effect.scoped)
  )
}

/**
 * Run server-side Effect programs (API routes, server actions) with spans
 * visible in Effect Dev Tools when enabled.
 */
export function runServerEffect<A, E>(
  spanName: string,
  effect: Effect.Effect<A, E>,
  options?: {
    readonly runId?: string
    readonly attributes?: Record<string, unknown>
  }
): Promise<A> {
  if (!options?.runId) {
    return Effect.runPromise(effect.pipe(Effect.withSpan(spanName)))
  }

  const runId = options.runId
  startTraceRun(runId, spanName)

  const program = Effect.tracerWith((tracer) =>
    effect.pipe(
      Effect.withSpan(spanName, {
        attributes: {
          ...options.attributes,
          runId,
        },
      }),
      Effect.withTracer(makeTraceCollectorTracer(runId, tracer)),
      Effect.withTracerTiming(true),
      Effect.ensuring(Effect.sync(() => completeTraceRun(runId)))
    )
  )

  return Effect.runPromise(program)
}
