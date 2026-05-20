"use client"

import type {
  EffectEditorCompletion,
  EffectEditorDiagnostic,
  EffectEditorHover,
} from "@/lib/effect-language-browser-core"

type WorkerResponse =
  | { readonly id: number; readonly success: true; readonly result: unknown }
  | { readonly id: number; readonly success: false; readonly error: string }

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

let worker: Worker | undefined
let requestId = 0
const pending = new Map<number, PendingRequest>()

function shouldUseServerFallback() {
  return process.env.NEXT_PUBLIC_EFFECT_LS_FALLBACK === "server"
}

function getWorker() {
  if (worker) {
    return worker
  }

  worker = new Worker(new URL("../workers/effect-language.worker.ts", import.meta.url), {
    type: "module",
  })
  worker.addEventListener("message", event => {
    const response = event.data as WorkerResponse
    const request = pending.get(response.id)
    if (!request) {
      return
    }
    pending.delete(response.id)
    if (response.success) {
      request.resolve(response.result)
    } else {
      request.reject(new Error(response.error))
    }
  })
  worker.addEventListener("error", event => {
    const error = new Error(event.message || "Effect language worker failed")
    for (const request of pending.values()) {
      request.reject(error)
    }
    pending.clear()
  })
  return worker
}

function callWorker<T>(message: Record<string, unknown>) {
  const id = ++requestId
  getWorker().postMessage({ id, ...message })
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: value => resolve(value as T),
      reject,
    })
  })
}

async function serverDiagnostics(input: {
  readonly fileName: string
  readonly source: string
}) {
  const response = await fetch("/api/effect-language-service/diagnostics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  const payload = (await response.json()) as
    | {
        readonly success: true
        readonly diagnostics: ReadonlyArray<EffectEditorDiagnostic>
        readonly durationMs: number
      }
    | { readonly success: false; readonly error: string }

  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? response.statusText : payload.error)
  }
  return payload
}

export const effectLanguageClient = {
  diagnostics(input: { readonly fileName: string; readonly source: string }) {
    if (shouldUseServerFallback()) {
      return serverDiagnostics(input)
    }
    return callWorker<{
      readonly diagnostics: ReadonlyArray<EffectEditorDiagnostic>
      readonly durationMs: number
    }>({
      type: "diagnostics",
      ...input,
    })
  },

  hover(input: {
    readonly fileName: string
    readonly source: string
    readonly lineNumber: number
    readonly column: number
  }) {
    return callWorker<EffectEditorHover | undefined>({
      type: "hover",
      ...input,
    })
  },

  completions(input: {
    readonly fileName: string
    readonly source: string
    readonly lineNumber: number
    readonly column: number
  }) {
    return callWorker<ReadonlyArray<EffectEditorCompletion>>({
      type: "completions",
      ...input,
    })
  },
}
