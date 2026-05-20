import { NextResponse } from "next/server"

import { createAlmostNodeProxySession, redactedProxyError } from "@/lib/almostnode-proxy"

export const runtime = "nodejs"

export async function POST() {
  try {
    const session = createAlmostNodeProxySession()
    return NextResponse.json({
      success: true,
      ...session,
      sandboxOrigin:
        process.env.ALMOSTNODE_SANDBOX_ORIGIN ?? "http://localhost:3002",
    })
  } catch (error) {
    const redacted = redactedProxyError(error)
    return NextResponse.json(
      { success: false, error: redacted.message },
      { status: redacted.status }
    )
  }
}
