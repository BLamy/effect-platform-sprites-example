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

function positiveInteger(value: unknown, defaultValue: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { spriteName, sessionId } = await context.params

  try {
    validateTerminalAccess({ request, spriteName, sessionId })
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    readonly cols?: unknown
    readonly rows?: unknown
  }
  const cols = positiveInteger(body.cols, 100)
  const rows = positiveInteger(body.rows, 30)
  const bridge = await ensureTerminalBridge({
    spriteName,
    sessionId,
    cols,
    rows,
  })
  bridge.command.resize(cols, rows)

  return Response.json({ success: true })
}
