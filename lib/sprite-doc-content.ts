export const runtimeSteps = [
  {
    label: "Host app",
    detail:
      "Next.js, Express, tests, or the sandbox supervisor create a Sprite value.",
  },
  {
    label: "SpriteContext",
    detail:
      "The local package provides Effect platform services for that Sprite.",
  },
  {
    label: "Sprite APIs",
    detail:
      "Command, FileSystem, and Terminal calls become exec, filesystem, and TTY API calls.",
  },
  {
    label: "Remote process",
    detail:
      "The Sprite runs normal shell or Node work; inside that process use NodeContext when needed.",
  },
] as const

export const quickCommands = [
  "npm install --prefix examples/effect-platform-sprites-next",
  "cp examples/effect-platform-sprites-next/.env.example examples/effect-platform-sprites-next/.env.local",
  "npm run example:sprites-next:dev -- --port 3001",
  "open http://localhost:3001 and run the shadcn Next.js Preview example",
  "npm run example:sprites-next:typecheck",
  "npm run example:sprites-next:build",
] as const

export const vscodeShellSetup = [
  {
    title: "Recommended extensions",
    body: "The workspace recommends Tagged Templates for shell highlighting, ShellCheck for shell files, and ShellCheckSelection for inline template linting.",
    command:
      "code --install-extension mike-north.vscode-tagged-templates\ncode --install-extension timonwong.shellcheck\ncode --install-extension lionas.shellcheckselection",
  },
  {
    title: "ShellCheck binary",
    body: "ShellCheck-based extensions need the shellcheck executable on PATH.",
    command: "brew install shellcheck",
  },
  {
    title: "Inline template linting",
    body: "Use the sh tag for highlighting. To lint inline shell, select only the shell body inside the template and run ShellCheckSelection: Run ShellCheck on Selection.",
    command:
      "sh`\nset -euo pipefail\nAPP_NAME=effect-platform-sprites-shadcn-next\nAPP_DIR=/tmp/$APP_NAME\n`",
  },
] as const

export const codeExamples = [
  {
    value: "command",
    title: "Scoped Command",
    description:
      "Use the normal Effect Command API. SpriteContext swaps the executor so the process runs remotely.",
    code: `import { Command } from "@effect/platform"
import { SpriteContext, sh } from "@replayio/effect-platform-sprites"

const context = new SpriteContext(
  "optional-old-sprite-id",
  "optional-checkpoint-id",
  {
    createIfMissing: true,
    spriteConfig: {
      url_settings: {
        auth: "sprite",
      },
    },
  }
)

const program = Command.string(
  sh\`printf 'hello from Sprite Command\\n'; printf 'pwd=%s\\n' "$PWD"; uname -s\`
)

await context.runPromise(program)`,
  },
  {
    value: "detached",
    title: "Detached Session",
    description:
      "Sandbox jobs are explicit detached sessions, not accidental leaked scoped commands.",
    code: `import { Deferred, Effect, Ref } from "effect"
import { SpriteContext, SpriteSession, sh } from "@replayio/effect-platform-sprites"

const launchSandbox = Effect.gen(function* () {
  const stdout = yield* Ref.make("")
  const exited = yield* Deferred.make<number>()

  const session = yield* SpriteSession.startDetached(
    sh\`printf 'detached session ran at '; date -u +%FT%TZ\`,
    {
      onStdout: chunk =>
        Ref.update(stdout, current => current + new TextDecoder().decode(chunk)),
      onExit: exitCode => Deferred.succeed(exited, exitCode).pipe(Effect.asVoid),
    }
  )

  const exitCode = yield* Deferred.await(exited)
  return { sessionId: session.sessionId, exitCode, output: yield* Ref.get(stdout) }
})

const context = new SpriteContext("optional-old-sprite-id")
await context.runPromise(launchSandbox)`,
  },
  {
    value: "filesystem",
    title: "Remote FileSystem",
    description:
      "Program against Effect FileSystem. The layer maps reads and writes onto the Sprite filesystem API.",
    code: `import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { SpriteContext, SpriteRuntime } from "@replayio/effect-platform-sprites"

const context = new SpriteContext("optional-old-sprite-id")

const writePayload = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = "/tmp/effect-platform-sprites-run.json"
  yield* fs.writeFileString(
    path,
    JSON.stringify(payload, null, 2)
  )
  const output = yield* fs.readFileString(path)
  yield* fs.remove(path)
  return output
})

await SpriteRuntime.runPromise(context, writePayload)`,
  },
  {
    value: "terminal",
    title: "Remote Terminal",
    description:
      "Use SpriteTerminal when you need a remote PTY. It is a Sprite terminal, not the user's host terminal.",
    code: `import { Effect } from "effect"
import { SpriteContext, SpriteTerminal } from "@replayio/effect-platform-sprites"

const openTty = Effect.gen(function* () {
  const tty = yield* SpriteTerminal.create({
    command: "/bin/sh",
    cols: 120,
    rows: 32,
  })

  yield* tty.write("printf 'remote tty is writable\\n'\\n")
  yield* tty.resize(100, 28)
  yield* tty.kill()
  return tty.sessionId
})

const context = new SpriteContext("optional-old-sprite-id")
await context.runPromise(openTty)`,
  },
  {
    value: "runtime",
    title: "Runtime Boundary",
    description:
      "Use SpriteRuntime at application edges. Keep library code as Effect values.",
    code: `import { Command } from "@effect/platform"
import { Effect } from "effect"
import { SpriteContext, SpriteRuntime, sh } from "@replayio/effect-platform-sprites"

const context = new SpriteContext(
  "optional-old-sprite-id",
  "optional-checkpoint-id"
)

const program = Effect.gen(function* () {
  const output = yield* Command.string(
    sh\`printf 'SpriteRuntime provided SpriteContext\\n'; printf 'whoami=%s\\n' "$(whoami)"\`
  )
  yield* Effect.logInfo("Remote runtime example completed", {
    bytes: output.length,
  })
  return output
})

const result = await SpriteRuntime.runPromise(context, program)`,
  },
  {
    value: "shadcn-next",
    title: "shadcn Preview",
    description:
      "Create a public Sprite, scaffold a shadcn Next.js app, install dependencies, start the dev server, and render the exposed URL below.",
    code: `import { Effect, Ref } from "effect"
import { SpriteClient, SpriteContext, SpriteSession, sh } from "@replayio/effect-platform-sprites"

const context = new SpriteContext("effect-platform-sprites-preview", undefined, {
  createIfMissing: true,
  spriteConfig: {
    url_settings: {
      auth: "public",
    },
  },
})

function previewUrlFromSprite(sprite: unknown) {
  return typeof sprite === "object" &&
    sprite !== null &&
    "url" in sprite &&
    typeof sprite.url === "string"
    ? sprite.url
    : undefined
}

const runPreview = Effect.gen(function* () {
  const spriteClient = yield* SpriteClient.Tag
  const stdout = yield* Ref.make("")

  const session = yield* SpriteSession.startDetached(
    sh\`
set -euo pipefail
APP_NAME=effect-platform-sprites-shadcn-next
APP_DIR=/tmp/$APP_NAME
if [ ! -f "$APP_DIR/package.json" ]; then
  npx --yes shadcn@latest create --template next --name "$APP_NAME" --cwd /tmp --defaults --yes
fi
cd "$APP_DIR"
npm install
npm run dev -- --hostname 0.0.0.0 --port 8080
\`,
    {
      onStdout: chunk =>
        Ref.update(stdout, current => current + new TextDecoder().decode(chunk)),
    }
  )

  return {
    sessionId: session.sessionId,
    previewUrl: previewUrlFromSprite(spriteClient.sprite),
    output: yield* Ref.get(stdout),
  }
})

await context.runPromise(runPreview)`,
  },
] as const

export type ExampleId = (typeof codeExamples)[number]["value"]

export const behaviorNotes = [
  {
    title: "Scoped commands clean up",
    body: "A normal Command.start is scoped. If the fiber is interrupted before exit, the Sprite exec session is killed.",
  },
  {
    title: "Detached sessions are explicit",
    body: "SpriteSession.startDetached is for sandbox launches and remote TTYs that should continue outside the caller scope.",
  },
  {
    title: "Typed platform errors",
    body: "Sprite API, protocol, timeout, unsupported operation, and non-zero exit failures map into Effect platform errors.",
  },
  {
    title: "Sprites own lifecycle cleanup",
    body: "The app should clean up jobs, callbacks, leases, and listeners. Sprite infrastructure handles Sprite termination.",
  },
] as const
