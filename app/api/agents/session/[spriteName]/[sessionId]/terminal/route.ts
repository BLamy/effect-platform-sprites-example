import { NextResponse, type NextRequest } from "next/server"

import {
  renderGhosttyWebTerminalPage,
  validateTerminalAccess,
} from "@/lib/remote-agent-session"

export const runtime = "nodejs"

interface RouteContext {
  readonly params: Promise<{
    readonly spriteName: string
    readonly sessionId: string
  }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { spriteName, sessionId } = await context.params

  try {
    validateTerminalAccess({ request, spriteName, sessionId })
  } catch {
    return new NextResponse("Not found", { status: 404 })
  }

  const token = new URL(request.url).searchParams.get("token") ?? ""
  return new NextResponse(
    renderGhosttyWebTerminalPage({ spriteName, sessionId, token }),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    }
  )
}
