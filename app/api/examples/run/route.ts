import { Effect } from "effect"
import { NextResponse, type NextRequest } from "next/server"

import { runServerEffect } from "@/lib/effect-devtools"
import {
  InvalidExampleError,
  MissingSpritesTokenError,
  parseExampleId,
  runSpriteExample,
  SpriteExampleRunError,
} from "@/lib/sprite-example-runs"

export const runtime = "nodejs"

function errorResponse(message: string, status: number, hint?: string) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      hint,
    },
    { status }
  )
}

function handleRunError(error: unknown) {
  if (error instanceof MissingSpritesTokenError) {
    return errorResponse(
      "SPRITES_TOKEN is not configured for this Next.js server.",
      503,
      "Set SPRITES_TOKEN in examples/effect-platform-sprites-next/.env.local and restart the dev server."
    )
  }

  if (error instanceof InvalidExampleError) {
    return errorResponse(`Unknown example: ${error.example}`, 400)
  }

  if (error instanceof SpriteExampleRunError) {
    return errorResponse(error.message, 502)
  }

  if (error instanceof Error) {
    return errorResponse(error.message, 500)
  }

  return errorResponse("Unknown Sprite example failure", 500)
}

function parseRunId(input: unknown) {
  if (typeof input !== "string") {
    return crypto.randomUUID()
  }

  const runId = input.trim()
  return /^[a-zA-Z0-9_-]{8,80}$/.test(runId) ? runId : crypto.randomUUID()
}

export async function POST(request: NextRequest) {
  const program = Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () =>
        request.json() as Promise<{ example?: unknown; runId?: unknown }>,
      catch: () => new InvalidExampleError({ example: "invalid-json" }),
    }).pipe(Effect.withSpan("parse-request-body"))

    const runId = parseRunId(body.runId)

    const example = yield* parseExampleId(body.example).pipe(
      Effect.withSpan("parse-example-id", {
        attributes: { example: String(body.example) },
      })
    )

    const result = yield* runSpriteExample(example, runId).pipe(
      Effect.withSpan("run-sprite-example", { attributes: { example, runId } })
    )

    return NextResponse.json({ success: true, result })
  }).pipe(Effect.catchAll((error) => Effect.succeed(handleRunError(error))))

  const url = new URL(request.url)
  const requestRunId = request.headers.get("x-effect-trace-run-id")

  return runServerEffect("POST /api/examples/run", program, {
    runId: requestRunId ?? url.searchParams.get("runId") ?? undefined,
  })
}
