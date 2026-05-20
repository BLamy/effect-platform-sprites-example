import { NextResponse, type NextRequest } from "next/server"

import {
  createRemoteClaudeSession,
  parseClaudeSessionInput,
} from "@/lib/remote-claude-session"

export const runtime = "nodejs"

function requestOrigin(request: NextRequest) {
  const url = new URL(request.url)
  const forwardedProto = request.headers.get("x-forwarded-proto")
  const forwardedHost = request.headers.get("x-forwarded-host")
  const host = forwardedHost ?? request.headers.get("host")

  if (host) {
    return `${forwardedProto ?? url.protocol.replace(/:$/, "")}://${host}`
  }

  return url.origin
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    },
    { status }
  )
}

export async function POST(request: NextRequest) {
  let input
  try {
    input = parseClaudeSessionInput(await request.json())
  } catch (error) {
    return errorResponse(error, 400)
  }

  try {
    const result = await createRemoteClaudeSession(
      input,
      requestOrigin(request)
    )
    return NextResponse.json({ success: true, result }, { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}
