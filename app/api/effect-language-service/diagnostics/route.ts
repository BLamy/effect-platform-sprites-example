import { NextResponse, type NextRequest } from "next/server"

import { getEffectLanguageDiagnostics } from "@/lib/effect-language-diagnostics"

export const runtime = "nodejs"

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status })
}

export async function POST(request: NextRequest) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return errorResponse("Invalid JSON body", 400)
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("source" in body) ||
    typeof body.source !== "string" ||
    !("fileName" in body) ||
    typeof body.fileName !== "string"
  ) {
    return errorResponse("Expected source and fileName strings", 400)
  }

  const startedAt = performance.now()
  const diagnostics = getEffectLanguageDiagnostics({
    fileName: body.fileName,
    source: body.source,
  })

  return NextResponse.json({
    success: true,
    diagnostics,
    durationMs: Math.round(performance.now() - startedAt),
  })
}
