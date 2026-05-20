import { NextResponse, type NextRequest } from "next/server"

import {
  executeAlmostNodeOutboundRequest,
  redactedProxyError,
  type AlmostNodeOutboundRequest,
} from "@/lib/almostnode-proxy"

export const runtime = "nodejs"

function corsHeaders() {
  return {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin":
      process.env.ALMOSTNODE_SANDBOX_ORIGIN ?? "http://localhost:3002",
    Vary: "Origin",
  }
}

function bearerToken(request: NextRequest) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
}

function validBody(value: unknown): value is AlmostNodeOutboundRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "service" in value &&
    typeof value.service === "string" &&
    "path" in value &&
    typeof value.path === "string"
  )
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  })
}

export async function POST(request: NextRequest) {
  try {
    const token = bearerToken(request)
    if (!token) {
      return NextResponse.json(
        { success: false, error: "Missing proxy session token" },
        { status: 401, headers: corsHeaders() }
      )
    }

    const body = (await request.json()) as unknown
    if (!validBody(body)) {
      return NextResponse.json(
        { success: false, error: "Expected service and path strings" },
        { status: 400, headers: corsHeaders() }
      )
    }

    const response = await executeAlmostNodeOutboundRequest({
      token,
      request: body,
    })

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...response.headers,
        ...corsHeaders(),
      },
    })
  } catch (error) {
    const redacted = redactedProxyError(error)
    return NextResponse.json(
      { success: false, error: redacted.message },
      { status: redacted.status, headers: corsHeaders() }
    )
  }
}
