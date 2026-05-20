import { NextResponse } from "next/server"

import { getTraceRun } from "@/lib/effect-traces"

export const runtime = "nodejs"

interface RouteContext {
  readonly params: Promise<{
    readonly runId: string
  }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { runId } = await context.params
  return NextResponse.json(getTraceRun(runId))
}
