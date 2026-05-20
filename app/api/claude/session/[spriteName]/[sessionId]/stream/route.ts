import { type NextRequest } from "next/server"

import {
  ensureTerminalBridge,
  validateTerminalAccess,
} from "@/lib/remote-claude-session"

export const runtime = "nodejs"

interface RouteContext {
  readonly params: Promise<{
    readonly spriteName: string
    readonly sessionId: string
  }>
}

function writeSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: string
) {
  controller.enqueue(
    new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`)
  )
}

function encodeTerminalData(chunk: Buffer | Uint8Array | string) {
  return Buffer.from(chunk).toString("base64")
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { spriteName, sessionId } = await context.params

  try {
    validateTerminalAccess({ request, spriteName, sessionId })
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const url = new URL(request.url)
  const cols = Number(url.searchParams.get("cols")) || 100
  const rows = Number(url.searchParams.get("rows")) || 30
  const bridge = await ensureTerminalBridge({
    spriteName,
    sessionId,
    cols,
    rows,
  })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const onData = (chunk: Buffer | Uint8Array | string) => {
        writeSse(controller, "data", encodeTerminalData(chunk))
      }
      const onExit = (code: number) => {
        writeSse(controller, "exit", String(code))
        controller.close()
      }
      const onError = (error: unknown) => {
        writeSse(
          controller,
          "terminal-error",
          encodeTerminalData(
            error instanceof Error ? error.message : String(error)
          )
        )
        controller.close()
      }
      const cleanup = () => {
        bridge.output.off("data", onData)
        bridge.output.off("exit", onExit)
        bridge.output.off("error", onError)
      }

      bridge.output.on("data", onData)
      bridge.output.on("exit", onExit)
      bridge.output.on("error", onError)
      request.signal.addEventListener("abort", cleanup, { once: true })
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
