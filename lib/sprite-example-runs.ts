import * as Command from "@effect/platform/Command"
import * as FileSystem from "@effect/platform/FileSystem"
import { Data, Deferred, Effect, Ref } from "effect"

import {
  SpriteClient,
  SpriteContext,
  SpriteSession,
  SpriteTerminal,
  sh,
  type SpriteContextServices,
} from "@replayio/effect-platform-sprites"

import type { ExampleId } from "@/lib/sprite-doc-content"

const allowedExamples = new Set<ExampleId>([
  "command",
  "detached",
  "filesystem",
  "terminal",
  "runtime",
  "shadcn-next",
])

const shadcnNextExample = "shadcn-next" satisfies ExampleId
const shadcnNextAppName = "effect-platform-sprites-shadcn-next"
const maxCapturedOutputLength = 24_000

export interface ExampleRunResult {
  readonly example: ExampleId
  readonly runId: string
  readonly spriteName: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly output: string
  readonly previewUrl?: string
  readonly previewTitle?: string
  readonly details: ReadonlyArray<{
    readonly label: string
    readonly value: string
  }>
}

interface SelectedExampleRunResult {
  readonly output: string
  readonly previewUrl?: string
  readonly previewTitle?: string
  readonly details: ReadonlyArray<{
    readonly label: string
    readonly value: string
  }>
}

export class MissingSpritesTokenError extends Data.TaggedError(
  "MissingSpritesTokenError"
)<{
  readonly variable: "SPRITES_TOKEN"
}> {}

export class InvalidExampleError extends Data.TaggedError(
  "InvalidExampleError"
)<{
  readonly example: string
}> {}

export class SpriteExampleRunError extends Data.TaggedError(
  "SpriteExampleRunError"
)<{
  readonly message: string
}> {}

function sanitizeSpriteName(name: string) {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)

  return sanitized || "effect-platform-sprites-example"
}

function exampleSpriteName() {
  return sanitizeSpriteName(
    process.env.SPRITES_EXAMPLE_SPRITE_NAME ??
      `effect-platform-sprites-example-${process.env.USER ?? "local"}`
  )
}

function exampleUrlAuth() {
  return process.env.SPRITES_EXAMPLE_URL_AUTH === "public" ? "public" : "sprite"
}

function spriteNameForExample(example: ExampleId) {
  const base = exampleSpriteName()
  if (example === shadcnNextExample) {
    return sanitizeSpriteName(`${base}-preview`)
  }
  return base
}

function urlAuthForExample(example: ExampleId) {
  if (example === shadcnNextExample) {
    return "public"
  }
  return exampleUrlAuth()
}

function getSpritesToken() {
  return Effect.sync(() => process.env.SPRITES_TOKEN).pipe(
    Effect.flatMap((token) =>
      token
        ? Effect.succeed(token)
        : Effect.fail(
            new MissingSpritesTokenError({ variable: "SPRITES_TOKEN" })
          )
    )
  )
}

function toExampleRunError(error: unknown) {
  if (error instanceof SpriteExampleRunError) {
    return error
  }
  if (error instanceof Error) {
    return new SpriteExampleRunError({ message: error.message })
  }
  return new SpriteExampleRunError({ message: String(error) })
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }
  return String(error)
}

function appendCapturedOutput(current: string, chunk: Uint8Array) {
  const next = current + new TextDecoder().decode(chunk)
  if (next.length <= maxCapturedOutputLength) {
    return next
  }

  return next.slice(next.length - maxCapturedOutputLength)
}

function shadcnNextPort() {
  return 8080
}

function shadcnNextRunAppName(runId: string) {
  return `${shadcnNextAppName}-${runId}`
}

function shadcnNextCommand(port: number, runId: string) {
  const appName = shadcnNextRunAppName(runId)
  return sh`set -euo pipefail

APP_NAME="${appName}"
APP_DIR="/tmp/$APP_NAME"
export CI=1
export NEXT_TELEMETRY_DISABLED=1
export npm_config_yes=true

rm -rf "$APP_DIR"
npx --yes shadcn@latest create --template next --name "$APP_NAME" --cwd /tmp --defaults --yes

cd "$APP_DIR"
npm install
npm run dev -- --hostname 0.0.0.0 --port ${port}
`
}

interface SpritePortNotification {
  readonly type: "port_opened"
  readonly port: number
  readonly address: string
  readonly pid: number
}

interface PreviewReady {
  readonly url: string
  readonly source: "exec port notification" | "ports API" | "HTTP probe"
}

function parseSpriteMessage(message: unknown) {
  if (typeof message !== "string") {
    return message
  }

  try {
    return JSON.parse(message) as unknown
  } catch {
    return message
  }
}

function portNotificationFor(
  message: unknown,
  port: number
): SpritePortNotification | undefined {
  const parsed = parseSpriteMessage(message)

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("type" in parsed) ||
    parsed.type !== "port_opened" ||
    !("port" in parsed) ||
    Number(parsed.port) !== port ||
    !("address" in parsed) ||
    typeof parsed.address !== "string" ||
    !("pid" in parsed)
  ) {
    return undefined
  }

  return {
    type: "port_opened",
    port: Number(parsed.port),
    address: parsed.address,
    pid: Number(parsed.pid),
  }
}

function portNotificationFromPortsMessage(
  message: unknown,
  port: number
): SpritePortNotification | undefined {
  const parsed = parseSpriteMessage(message)

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "type" in parsed &&
    parsed.type === "port_list" &&
    "ports" in parsed &&
    Array.isArray(parsed.ports)
  ) {
    return parsed.ports
      .map((item) => portNotificationFor(item, port))
      .find((item): item is SpritePortNotification => Boolean(item))
  }

  return portNotificationFor(parsed, port)
}

function previewUrlFromNotification(notification: SpritePortNotification) {
  const address = notification.address.trim()
  if (!address) {
    return undefined
  }

  if (/^https?:\/\//.test(address)) {
    return address
  }

  return `https://${address}`
}

function previewUrlFromSprite(sprite: unknown, port: number) {
  const url =
    typeof sprite === "object" &&
    sprite !== null &&
    "url" in sprite &&
    typeof sprite.url === "string"
      ? sprite.url
      : undefined

  if (!url) {
    return undefined
  }

  const previewUrl = new URL(url)
  if (port !== 8080) {
    previewUrl.port = String(port)
  }
  return previewUrl.toString()
}

function waitForPreviewUrl(url: string): Effect.Effect<string, never> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      })
      await response.arrayBuffer()

      if (response.status >= 200 && response.status < 500) {
        return url
      }

      throw new Error(`HTTP ${response.status}`)
    },
    catch: () => undefined,
  }).pipe(
    Effect.catchAll(() =>
      Effect.sleep("2 seconds").pipe(Effect.flatMap(() => waitForPreviewUrl(url)))
    )
  )
}

function watchSpritePort(
  sprite: {
    readonly name: string
    readonly client: { readonly baseURL: string; readonly token: string }
  },
  port: number
): Effect.Effect<PreviewReady, never> {
  return Effect.async<PreviewReady>((resume) => {
    const baseURL = (sprite.client.baseURL || "https://api.sprites.dev").replace(
      /\/+$/,
      ""
    )
    const wsURL = new URL(
      `/v1/sprites/${encodeURIComponent(sprite.name)}/ports/watch`,
      baseURL.replace(/^http/, "ws")
    )
    const WebSocketWithHeaders = WebSocket as unknown as new (
      url: string,
      options: { readonly headers: Record<string, string> }
    ) => WebSocket
    const ws = new WebSocketWithHeaders(wsURL.toString(), {
      headers: {
        Authorization: `Bearer ${sprite.client.token}`,
      },
    })

    const close = () => {
      try {
        ws.close()
      } catch {
        // Nothing to release if the socket is already closed.
      }
    }

    ws.addEventListener("message", (event) => {
      const notification = portNotificationFromPortsMessage(event.data, port)
      if (!notification) {
        return
      }

      const url = previewUrlFromNotification(notification)
      if (url) {
        close()
        resume(
          Effect.succeed({
            url,
            source: "ports API" as const,
          })
        )
      }
    })

    ws.addEventListener("error", () => {
      close()
    })

    return Effect.sync(close)
  })
}

function runCommandExample() {
  return Effect.gen(function* () {
    const output = yield* Command.string(
      sh`printf 'hello from Sprite Command\n'; printf 'pwd=%s\n' "$PWD"; uname -s`
    ).pipe(Effect.withSpan("example.command.string"))

    return {
      output,
      details: [
        { label: "Effect API", value: "Command.string(sh`...`)" },
        { label: "Executor", value: "SpriteCommandExecutor" },
      ],
    }
  }).pipe(Effect.withSpan("example.command"))
}

function runFilesystemExample(runId: string) {
  const path = `/tmp/effect-platform-sprites-${runId}.json`
  const payload = {
    runId,
    createdBy: "@replayio/effect-platform-sprites",
    createdAt: new Date().toISOString(),
  }

  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.writeFileString(path, JSON.stringify(payload, null, 2)).pipe(
      Effect.withSpan("example.filesystem.write", {
        attributes: { path },
      })
    )
    const output = yield* fs.readFileString(path).pipe(
      Effect.withSpan("example.filesystem.read", {
        attributes: { path },
      })
    )
    yield* fs.remove(path).pipe(
      Effect.withSpan("example.filesystem.remove", {
        attributes: { path },
      })
    )

    return {
      output,
      details: [
        {
          label: "Effect API",
          value: "FileSystem.writeFileString/readFileString",
        },
        { label: "Remote path", value: path },
      ],
    }
  }).pipe(Effect.withSpan("example.filesystem"))
}

function runRuntimeExample() {
  return Effect.gen(function* () {
    const output = yield* Command.string(
      sh`printf 'SpriteRuntime provided SpriteContext\n'; printf 'whoami=%s\n' "$(whoami)"`
    ).pipe(Effect.withSpan("example.runtime.command"))
    yield* Effect.logInfo("SpriteRuntime example completed", {
      bytes: output.length,
    })

    return {
      output,
      details: [
        {
          label: "Effect API",
          value: "SpriteRuntime.runPromise(context, program)",
        },
        { label: "Boundary", value: "Server route" },
      ],
    }
  }).pipe(Effect.withSpan("example.runtime"))
}

function runDetachedExample() {
  const decoder = new TextDecoder()
  return Effect.gen(function* () {
    const stdout = yield* Ref.make("")
    const exited = yield* Deferred.make<number>()

    const handle = yield* SpriteSession.startDetached(
      sh`printf 'detached session ran at '; date -u +%FT%TZ`,
      {
        onStdout: (chunk) =>
          Ref.update(stdout, (current) => current + decoder.decode(chunk)),
        onExit: (exitCode) =>
          Deferred.succeed(exited, exitCode).pipe(Effect.asVoid),
      }
    ).pipe(Effect.withSpan("example.detached.start-session"))

    const exitCode = yield* Deferred.await(exited).pipe(
      Effect.timeoutFail({
        duration: "15 seconds",
        onTimeout: () =>
          new SpriteExampleRunError({
            message: "Timed out waiting for detached session exit",
          }),
      })
    )
    yield* Effect.sleep("100 millis")
    const output = yield* Ref.get(stdout)

    return {
      output: output || "(detached session produced no stdout)",
      details: [
        { label: "Effect API", value: "SpriteSession.startDetached" },
        { label: "Session ID", value: handle.sessionId ?? "not reported" },
        { label: "Exit code", value: String(exitCode) },
      ],
    }
  }).pipe(Effect.withSpan("example.detached"))
}

function runTerminalExample() {
  return Effect.gen(function* () {
    const tty = yield* SpriteTerminal.create({
      command: "/bin/sh",
      cols: 120,
      rows: 32,
    }).pipe(Effect.withSpan("example.terminal.create"))

    yield* tty.write("printf 'remote tty is writable\\n'\n").pipe(
      Effect.withSpan("example.terminal.write")
    )
    yield* tty.resize(100, 28).pipe(Effect.withSpan("example.terminal.resize"))
    yield* tty.kill().pipe(Effect.withSpan("example.terminal.kill"))

    return {
      output:
        "created remote TTY, wrote one command, resized it, and killed it",
      details: [
        { label: "Effect API", value: "SpriteTerminal.create" },
        { label: "Session ID", value: tty.sessionId ?? "not reported" },
        { label: "TTY size", value: "100x28 after resize" },
      ],
    }
  }).pipe(Effect.withSpan("example.terminal"))
}

function runShadcnNextExample(runId: string) {
  const port = shadcnNextPort()
  return Effect.gen(function* () {
    const spriteClient = yield* SpriteClient.Tag
    const fallbackPreviewUrl = previewUrlFromSprite(spriteClient.sprite, port)
    const stdout = yield* Ref.make("")
    const stderr = yield* Ref.make("")
    const opened = yield* Deferred.make<
      SpritePortNotification,
      SpriteExampleRunError
    >()

    const handle = yield* SpriteSession.startDetached(
      shadcnNextCommand(port, runId),
      {
        tty: true,
        cols: 120,
        rows: 32,
        onStdout: (chunk) =>
          Ref.update(stdout, (current) => appendCapturedOutput(current, chunk)),
        onStderr: (chunk) =>
          Ref.update(stderr, (current) => appendCapturedOutput(current, chunk)),
        onExit: (exitCode) =>
          exitCode === 0
            ? Effect.void
            : Effect.gen(function* () {
                const capturedStdout = (yield* Ref.get(stdout)).trim()
                const capturedStderr = (yield* Ref.get(stderr)).trim()
                const message = [
                  `shadcn Next.js preview exited before opening port ${port} (exit ${exitCode})`,
                  capturedStdout ? `stdout:\n${capturedStdout}` : undefined,
                  capturedStderr ? `stderr:\n${capturedStderr}` : undefined,
                ]
                  .filter((part): part is string => Boolean(part))
                  .join("\n\n")
                yield* Deferred.fail(opened, new SpriteExampleRunError({ message }))
              }),
        onError: (error) =>
          Deferred.fail(
            opened,
            new SpriteExampleRunError({
              message: `shadcn Next.js preview failed to start: ${errorMessage(error)}`,
            })
          ).pipe(Effect.asVoid),
      }
    ).pipe(
      Effect.withSpan("example.shadcn.start-session", {
        attributes: { port, app: shadcnNextRunAppName(runId) },
      })
    )

    const onMessage = (message: unknown) => {
      const notification = portNotificationFor(message, port)
      if (notification) {
        Effect.runFork(Deferred.succeed(opened, notification).pipe(Effect.asVoid))
      }
    }

    yield* Effect.sync(() => {
      handle.process.on("message", onMessage)
    })

    const notificationReady = Deferred.await(opened).pipe(
      Effect.flatMap((notification): Effect.Effect<PreviewReady, SpriteExampleRunError> => {
        const previewUrl = previewUrlFromNotification(notification)
        return previewUrl
          ? Effect.succeed({
              url: previewUrl,
              source: "exec port notification" as const,
            })
          : Effect.fail(
              new SpriteExampleRunError({
                message: "Sprite port notification did not include a preview URL",
              })
            )
      })
    )
    const httpReady = fallbackPreviewUrl
      ? waitForPreviewUrl(fallbackPreviewUrl).pipe(
          Effect.map((url) => ({
            url,
            source: "HTTP probe" as const,
          }))
        )
      : Effect.never
    const portsReady = watchSpritePort(spriteClient.sprite, port)

    const ready = yield* Effect.raceFirst(
      portsReady,
      Effect.raceFirst(notificationReady, httpReady)
    ).pipe(
      Effect.withSpan("example.shadcn.wait-for-preview", {
        attributes: { port },
      }),
      Effect.timeoutFail({
        duration: "7 minutes",
        onTimeout: () =>
          new SpriteExampleRunError({
            message:
              "Timed out waiting for the shadcn Next.js dev server to expose a Sprite URL",
          }),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          handle.process.off("message", onMessage)
        })
      )
    )
    yield* Effect.sleep("1 second")

    const output = [
      "Provisioned shadcn Next.js preview inside the Sprite.",
      "",
      "stdout:",
      (yield* Ref.get(stdout)).trim() || "(no stdout captured yet)",
      "",
      "stderr:",
      (yield* Ref.get(stderr)).trim() || "(no stderr captured yet)",
    ].join("\n")

    return {
      output,
      details: [
        { label: "Effect API", value: "SpriteSession.startDetached" },
        { label: "Sprite URL auth", value: "public" },
        { label: "Readiness", value: ready.source },
        { label: "App directory", value: `/tmp/${shadcnNextRunAppName(runId)}` },
        { label: "Remote port", value: String(port) },
        { label: "Session ID", value: handle.sessionId ?? "not reported" },
      ],
      previewUrl: ready.url,
      previewTitle: "shadcn Next.js preview",
    }
  }).pipe(Effect.withSpan("example.shadcn"))
}

function runSelectedExample(
  example: ExampleId,
  runId: string
): Effect.Effect<SelectedExampleRunResult, unknown, SpriteContextServices> {
  switch (example) {
    case "command":
      return runCommandExample()
    case "detached":
      return runDetachedExample()
    case "filesystem":
      return runFilesystemExample(runId)
    case "terminal":
      return runTerminalExample()
    case "runtime":
      return runRuntimeExample()
    case "shadcn-next":
      return runShadcnNextExample(runId)
  }
}

export function parseExampleId(input: unknown) {
  if (typeof input !== "string" || !allowedExamples.has(input as ExampleId)) {
    return Effect.fail(new InvalidExampleError({ example: String(input) }))
  }

  return Effect.succeed(input as ExampleId)
}

export function runSpriteExample(example: ExampleId, runId: string) {
  return Effect.gen(function* () {
    const startedAtMs = Date.now()
    const startedAt = new Date(startedAtMs).toISOString()
    const token = yield* getSpritesToken()
    const spriteName = spriteNameForExample(example)
    const context = new SpriteContext(spriteName, undefined, {
      token,
      createIfMissing: true,
      requestTimeoutMs: 30_000,
      spriteConfig: {
        url_settings: {
          auth: urlAuthForExample(example),
        },
      },
    })
    const run = yield* runSelectedExample(example, runId).pipe(
      Effect.provide(context.layer()),
      Effect.timeoutFail({
        duration: example === shadcnNextExample ? "8 minutes" : "60 seconds",
        onTimeout: () =>
          new SpriteExampleRunError({
            message: "Timed out waiting for Sprite example to finish",
          }),
      }),
      Effect.mapError(toExampleRunError)
    )
    const finishedAtMs = Date.now()

    return {
      example,
      runId,
      spriteName,
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      output: run.output,
      previewUrl: run.previewUrl,
      previewTitle: run.previewTitle,
      details: run.details,
    } satisfies ExampleRunResult
  })
}
