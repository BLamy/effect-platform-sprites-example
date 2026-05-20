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

export async function POST(request: NextRequest, context: RouteContext) {
  const { spriteName, sessionId } = await context.params

  try {
    validateTerminalAccess({ request, spriteName, sessionId })
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const bridge = await ensureTerminalBridge({
    spriteName,
    sessionId,
    cols: 100,
    rows: 30,
  })
  bridge.command.stdin.write(await request.text())

  return new Response(null, { status: 204 })
}
