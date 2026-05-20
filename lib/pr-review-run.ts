import { createClient } from "@supabase/supabase-js"
import { Data, Effect } from "effect"
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { parsePullRequestSelector } from "@/lib/pr-review-code"

export interface PrReviewRunInput {
  readonly prSelector: string
  readonly baseUrl?: string
  readonly triggerId?: string
  readonly rebuildSandboxScript?: boolean
  readonly purgeExistingJobs?: boolean
}

interface CommandResult {
  readonly command: string
  readonly output: string
}

interface PurgedSandboxJob {
  readonly job_key: string | null
  readonly status: string | null
  readonly head_sha: string | null
}

export interface PrReviewRunResult {
  readonly repository: string
  readonly pullRequestId: string
  readonly triggerId: string
  readonly baseUrl: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly rebuiltSandboxScript: boolean
  readonly purgedJobs: ReadonlyArray<{
    readonly jobKey: string | null
    readonly status: string | null
    readonly headSha: string | null
  }>
  readonly botResponse: {
    readonly status: number
    readonly statusText: string
    readonly body: string | null
  }
  readonly output: string
}

export class InvalidPrReviewInputError extends Data.TaggedError(
  "InvalidPrReviewInputError"
)<{
  readonly message: string
}> {}

export class MissingPrReviewEnvError extends Data.TaggedError(
  "MissingPrReviewEnvError"
)<{
  readonly variable: string
}> {}

export class PrReviewRunError extends Data.TaggedError("PrReviewRunError")<{
  readonly message: string
}> {}

const maxCapturedOutputLength = 32_000

function appendCapturedOutput(current: string, chunk: Buffer | string) {
  const next = current + chunk.toString()
  if (next.length <= maxCapturedOutputLength) {
    return next
  }

  return next.slice(next.length - maxCapturedOutputLength)
}

function parseEnvFile(contents: string) {
  const values = new Map<string, string>()
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
    if (!match) {
      continue
    }

    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    values.set(match[1], value)
  }
  return values
}

function findReplayEndpointsRoot() {
  let current = process.cwd()

  while (true) {
    const triggerScript = path.join(current, "scripts", "trigger-bot.ts")
    const packagePath = path.join(current, "package.json")
    if (existsSync(triggerScript) && existsSync(packagePath)) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error("Could not find replay-endpoints checkout root")
    }
    current = parent
  }
}

function envFilePaths(root: string) {
  const paths: string[] = []
  let current = process.cwd()

  while (true) {
    paths.push(path.join(current, ".env.local"))
    paths.push(path.join(current, ".env"))
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  paths.push(path.join(root, ".env.local"), path.join(root, ".env"))
  return [...new Set(paths)]
}

function getOptionalEnv(root: string, variable: string) {
  const processValue = process.env[variable]?.trim()
  if (processValue) {
    return processValue
  }

  for (const envPath of envFilePaths(root)) {
    if (!existsSync(envPath)) {
      continue
    }
    const value = parseEnvFile(readFileSync(envPath, "utf8"))
      .get(variable)
      ?.trim()
    if (value) {
      return value
    }
  }

  return undefined
}

function getRequiredEnv(root: string, variable: string) {
  const value = getOptionalEnv(root, variable)
  return value
    ? Effect.succeed(value)
    : Effect.fail(new MissingPrReviewEnvError({ variable }))
}

function runCommand(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string
): Effect.Effect<CommandResult, PrReviewRunError> {
  return Effect.async<CommandResult, PrReviewRunError>((resume) => {
    let output = ""
    const child = spawn(command, [...args], {
      cwd,
      env: process.env,
    })

    child.stdout.on("data", (chunk: Buffer) => {
      output = appendCapturedOutput(output, chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      output = appendCapturedOutput(output, chunk)
    })
    child.on("error", (error) => {
      resume(
        Effect.fail(
          new PrReviewRunError({
            message: `${command} ${args.join(" ")} failed to start: ${error.message}`,
          })
        )
      )
    })
    child.on("close", (code) => {
      if (code === 0) {
        resume(
          Effect.succeed({
            command: `${command} ${args.join(" ")}`,
            output,
          })
        )
      } else {
        resume(
          Effect.fail(
            new PrReviewRunError({
              message: `${command} ${args.join(" ")} failed with exit code ${code}\n${output}`,
            })
          )
        )
      }
    })

    return Effect.sync(() => {
      child.kill()
    })
  })
}

function purgeExistingSandboxJobs(
  root: string,
  repository: string,
  pullRequestId: string
) {
  return Effect.gen(function* () {
    const [owner, repo] = repository.split("/")
    if (!owner || !repo) {
      return yield* Effect.fail(
        new InvalidPrReviewInputError({
          message: `Invalid repository ${JSON.stringify(repository)}`,
        })
      )
    }

    const supabaseUrl = yield* getRequiredEnv(
      root,
      "REPLAY_CI_BOT_SUPABASE_URL"
    )
    const supabaseSecret = yield* getRequiredEnv(
      root,
      "REPLAY_CI_BOT_SUPABASE_SECRET_KEY"
    )

    const supabase = createClient(supabaseUrl, supabaseSecret)
    const response = yield* Effect.tryPromise({
      try: () =>
        supabase
          .from("jobs")
          .delete()
          .eq("owner", owner)
          .eq("repo", repo)
          .eq("pr_number", Number(pullRequestId))
          .select("job_key, status, head_sha"),
      catch: (error) =>
        new PrReviewRunError({
          message:
            error instanceof Error
              ? error.message
              : `Supabase purge failed: ${String(error)}`,
        }),
    })

    if (response.error) {
      return yield* Effect.fail(
        new PrReviewRunError({ message: response.error.message })
      )
    }

    return (response.data ?? []) as ReadonlyArray<PurgedSandboxJob>
  })
}

function postBotTrigger(input: {
  readonly root: string
  readonly baseUrl: string
  readonly triggerId: string
  readonly repository: string
  readonly pullRequestId: string
}) {
  return Effect.gen(function* () {
    const webhookSecret = yield* getRequiredEnv(
      input.root,
      "RECORD_REPLAY_WEBHOOK_SECRET"
    )
    const endpoint = `${input.baseUrl.replace(/\/+$/, "")}/api/bot`
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-replay-webhook-secret": webhookSecret,
          },
          body: JSON.stringify({
            id: input.triggerId,
            repository: input.repository,
            pullRequestId: input.pullRequestId,
          }),
        }),
      catch: (error) =>
        new PrReviewRunError({
          message:
            error instanceof Error
              ? error.message
              : `Bot trigger request failed: ${String(error)}`,
        }),
    })

    const body = yield* Effect.promise(() => response.text())
    if (!response.ok) {
      return yield* Effect.fail(
        new PrReviewRunError({
          message: `Bot trigger failed with ${response.status} ${response.statusText}: ${body}`,
        })
      )
    }

    return {
      status: response.status,
      statusText: response.statusText,
      body: body || null,
    }
  })
}

function defaultBaseUrl(root: string) {
  return (
    getOptionalEnv(root, "REPLAY_ENDPOINTS_BASE_URL") ?? "http://127.0.0.1:4317"
  )
}

export function parsePrReviewRunInput(body: unknown): PrReviewRunInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InvalidPrReviewInputError({
      message: "Request body must be a JSON object",
    })
  }

  const record = body as Record<string, unknown>
  if (typeof record.prSelector !== "string" || !record.prSelector.trim()) {
    throw new InvalidPrReviewInputError({
      message: "prSelector is required in owner/repo#123 format",
    })
  }

  return {
    prSelector: record.prSelector.trim(),
    baseUrl:
      typeof record.baseUrl === "string" && record.baseUrl.trim()
        ? record.baseUrl.trim()
        : undefined,
    triggerId:
      typeof record.triggerId === "string" && record.triggerId.trim()
        ? record.triggerId.trim()
        : undefined,
    rebuildSandboxScript: record.rebuildSandboxScript !== false,
    purgeExistingJobs: record.purgeExistingJobs !== false,
  }
}

export function runPrReview(input: PrReviewRunInput) {
  return Effect.gen(function* () {
    const startedAtMs = Date.now()
    const startedAt = new Date(startedAtMs).toISOString()
    const root = yield* Effect.try({
      try: findReplayEndpointsRoot,
      catch: (error) =>
        new PrReviewRunError({
          message: error instanceof Error ? error.message : String(error),
        }),
    })
    const { repository, pullRequestId } = yield* Effect.try({
      try: () => parsePullRequestSelector(input.prSelector),
      catch: (error) =>
        new InvalidPrReviewInputError({
          message: error instanceof Error ? error.message : String(error),
        }),
    })
    const baseUrl = input.baseUrl ?? defaultBaseUrl(root)
    const triggerId = input.triggerId ?? `local-effect-pr-review-${Date.now()}`
    const shouldRebuild = input.rebuildSandboxScript !== false
    const shouldPurge = input.purgeExistingJobs !== false

    const buildResult = shouldRebuild
      ? yield* runCommand(
          "npm",
          ["run", "build:sandbox-jobs-sprite-script"],
          root
        ).pipe(Effect.withSpan("build-sandbox-jobs-sprite-script"))
      : undefined

    const purgedJobs = shouldPurge
      ? yield* purgeExistingSandboxJobs(root, repository, pullRequestId).pipe(
          Effect.withSpan("purge-existing-sandbox-jobs", {
            attributes: { repository, pullRequestId },
          })
        )
      : []

    const botResponse = yield* postBotTrigger({
      root,
      baseUrl,
      triggerId,
      repository,
      pullRequestId,
    }).pipe(
      Effect.withSpan("post-bot-trigger", {
        attributes: { repository, pullRequestId, baseUrl },
      })
    )

    const finishedAtMs = Date.now()
    const output = [
      buildResult
        ? `$ ${buildResult.command}\n${buildResult.output.trim() || "(no output)"}`
        : "Skipped sandbox Sprite script rebuild.",
      "",
      shouldPurge
        ? `Purged ${purgedJobs.length} existing sandbox job${purgedJobs.length === 1 ? "" : "s"}.`
        : "Skipped existing sandbox job purge.",
      "",
      `POST ${baseUrl.replace(/\/+$/, "")}/api/bot -> ${botResponse.status} ${botResponse.statusText}`,
      botResponse.body ? `response:\n${botResponse.body}` : "response: (empty)",
    ].join("\n")

    return {
      repository,
      pullRequestId,
      triggerId,
      baseUrl,
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      rebuiltSandboxScript: shouldRebuild,
      purgedJobs: purgedJobs.map((job) => ({
        jobKey: job.job_key,
        status: job.status,
        headSha: job.head_sha,
      })),
      botResponse,
      output,
    } satisfies PrReviewRunResult
  })
}
