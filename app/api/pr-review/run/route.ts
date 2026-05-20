import { Effect } from "effect"
import { NextResponse, type NextRequest } from "next/server"

import { runServerEffect } from "@/lib/effect-devtools"
import {
  InvalidPrReviewInputError,
  MissingPrReviewEnvError,
  parsePrReviewRunInput,
  PrReviewRunError,
  runPrReview,
} from "@/lib/pr-review-run"

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
  if (error instanceof InvalidPrReviewInputError) {
    return errorResponse(error.message, 400)
  }

  if (error instanceof MissingPrReviewEnvError) {
    return errorResponse(
      `${error.variable} is not configured for this Next.js server.`,
      503,
      "Set the same bot env vars used by npm run trigger:bot in .env or .env.local, then restart the dev server."
    )
  }

  if (error instanceof PrReviewRunError) {
    return errorResponse(error.message, 502)
  }

  if (error instanceof Error) {
    return errorResponse(error.message, 500)
  }

  return errorResponse("Unknown PR review trigger failure", 500)
}

function parseRunId(input: unknown) {
  if (typeof input !== "string") {
    return undefined
  }

  const runId = input.trim()
  return /^[a-zA-Z0-9_-]{8,80}$/.test(runId) ? runId : undefined
}

export async function POST(request: NextRequest) {
  const program = Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => request.json() as Promise<unknown>,
      catch: () =>
        new InvalidPrReviewInputError({
          message: "Request body must be valid JSON",
        }),
    }).pipe(Effect.withSpan("parse-request-body"))

    const input = yield* Effect.try({
      try: () => parsePrReviewRunInput(body),
      catch: (error) =>
        error instanceof InvalidPrReviewInputError
          ? error
          : new InvalidPrReviewInputError({ message: String(error) }),
    }).pipe(Effect.withSpan("parse-pr-review-input"))

    const result = yield* runPrReview(input).pipe(
      Effect.withSpan("run-pr-review-effect", {
        attributes: { prSelector: input.prSelector },
      })
    )

    return NextResponse.json({ success: true, result })
  }).pipe(Effect.catchAll((error) => Effect.succeed(handleRunError(error))))

  const url = new URL(request.url)
  const requestRunId = request.headers.get("x-effect-trace-run-id")

  return runServerEffect("POST /api/pr-review/run", program, {
    runId: parseRunId(requestRunId) ?? parseRunId(url.searchParams.get("runId")),
  })
}
