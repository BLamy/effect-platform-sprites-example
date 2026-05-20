export interface PrReviewFormInput {
  readonly prSelector: string
  readonly baseUrl: string
  readonly triggerId: string
  readonly rebuildSandboxScript: boolean
  readonly purgeExistingJobs: boolean
}

export interface ParsedPullRequestSelector {
  readonly repository: string
  readonly pullRequestId: string
}

function literal(value: unknown) {
  return JSON.stringify(value)
}

export function parsePullRequestSelector(
  input: string
): ParsedPullRequestSelector {
  const match = input.trim().match(/^([^#]+)#(\d+)$/)
  if (!match) {
    throw new Error(
      `Invalid PR selector ${literal(input)}. Expected format: owner/repo#123`
    )
  }

  return {
    repository: match[1],
    pullRequestId: match[2],
  }
}

export function prReviewEffectCode(input: PrReviewFormInput) {
  return `import { Effect } from "effect"
import { runPrReview } from "@/lib/pr-review-run"

const program = runPrReview({
  prSelector: ${literal(input.prSelector)},
  baseUrl: ${literal(input.baseUrl)},
  triggerId: ${literal(input.triggerId)},
  rebuildSandboxScript: ${String(input.rebuildSandboxScript)},
  purgeExistingJobs: ${String(input.purgeExistingJobs)},
}).pipe(
  Effect.withSpan("run-pr-review-effect", {
    attributes: { prSelector: ${literal(input.prSelector)} },
  })
)

await Effect.runPromise(program)

// runPrReview is the Effect.gen program behind POST /api/pr-review/run.
// It validates owner/repo#123, optionally runs:
//   npm run build:sandbox-jobs-sprite-script
// optionally purges Supabase jobs for that PR, then POSTs to /api/bot
// with the same custom local payload used by scripts/trigger-bot.ts.`
}
