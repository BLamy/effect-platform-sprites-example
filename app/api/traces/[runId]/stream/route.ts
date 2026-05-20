import { type NextRequest } from "next/server"

import { subscribeTraceRun, type TraceStreamEvent } from "@/lib/effect-traces"

export const runtime = "nodejs"

interface RouteContext {
  readonly params: Promise<{
    readonly runId: string
  }>
}

function writeSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: TraceStreamEvent
) {
  controller.enqueue(
    new TextEncoder().encode(
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    )
  )
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { runId } = await context.params

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const unsubscribe = subscribeTraceRun(runId, (event) => {
        writeSse(controller, event)
      })

      request.signal.addEventListener("abort", unsubscribe, { once: true })
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  })
}
