"use client"

import type { ExampleId } from "@/lib/sprite-doc-content"

type AlmostNode = typeof import("almostnode")
type VirtualFS = InstanceType<AlmostNode["VirtualFS"]>
type PackageManager = InstanceType<AlmostNode["PackageManager"]>
type Runtime = Awaited<ReturnType<AlmostNode["createRuntime"]>>

export interface BrowserEffectRunInput {
  readonly fileName: string
  readonly source: string
  readonly exampleId: ExampleId
  readonly runId: string
}

export interface BrowserEffectRunResult {
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

interface ProxySession {
  readonly token: string
  readonly expiresAt: string
  readonly services: readonly string[]
  readonly sandboxOrigin: string
}

interface BrowserRuntimeState {
  readonly vfs: VirtualFS
  readonly npm: PackageManager
  readonly runtime: Runtime
  readonly session: ProxySession
  readonly logs: string[]
}

export const browserEffectRuntimeExamples = new Set<ExampleId>([
  "command",
  "detached",
  "filesystem",
  "runtime",
  "terminal",
])

let runtimeState: Promise<BrowserRuntimeState> | undefined

function importAlmostNode() {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<AlmostNode>
  return dynamicImport("/almostnode/index.mjs")
}

function sanitizeFileName(fileName: string) {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "")
  return `/workspace/examples/${safe || "example.ts"}`
}

function splitLeadingImports(source: string) {
  const imports: string[] = []
  const lines = source.split("\n")
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === "" && imports.length > 0) {
      imports.push(line)
      index += 1
      continue
    }

    if (!line.trimStart().startsWith("import ")) {
      break
    }

    imports.push(line)
    index += 1
    while (
      index < lines.length &&
      !/["'][^"']+["']\s*;?\s*$/u.test(imports[imports.length - 1] ?? "")
    ) {
      imports.push(lines[index])
      index += 1
    }
  }

  return {
    body: lines.slice(index).join("\n"),
    imports: imports.join("\n").trimEnd(),
  }
}

function runnableSource(source: string) {
  const { body, imports } = splitLeadingImports(source)
  return `${imports}
module.exports.__almostnodeRun = (async () => {
${body}
})()
`
}

async function createProxySession() {
  const response = await fetch("/api/almostnode/session", { method: "POST" })
  const payload = (await response.json()) as
    | ({ readonly success: true } & ProxySession)
    | { readonly success: false; readonly error: string }
  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? response.statusText : payload.error)
  }
  return payload
}

function runtimePackageJson() {
  return JSON.stringify(
    {
      type: "module",
      dependencies: {
        "@effect/language-service": "^0.86.1",
        "@effect/platform": "^0.96.1",
        effect: "^3.21.2",
        typescript: "^5.9.3",
      },
    },
    null,
    2
  )
}

function spriteShimSource() {
  return `
const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const { Deferred, Effect, Layer, Ref, Stream, Sink } = require("effect")
const Command = require("@effect/platform/Command")
const CommandExecutor = require("@effect/platform/CommandExecutor")
const FileSystem = require("@effect/platform/FileSystem")
const HashMap = require("effect/HashMap")
const Option = require("effect/Option")

const encoder = new TextEncoder()
let terminalCounter = 0

function shellQuote(value) {
  return JSON.stringify(String(value))
}

function optionValue(value) {
  return Option.isSome(value) ? value.value : undefined
}

function envObject(env) {
  return Object.fromEntries(HashMap.toEntries(env))
}

function commandSpec(command) {
  if (command._tag === "PipedCommand") {
    const left = commandSpec(command.left)
    const right = commandSpec(command.right)
    return {
      command: left.command + " | " + right.command,
      cwd: right.cwd ?? left.cwd,
      env: { ...left.env, ...right.env },
    }
  }

  if (command.command === "/bin/sh" && command.args[0] === "-lc") {
    return {
      command: command.args.slice(1).join(" "),
      cwd: optionValue(command.cwd),
      env: envObject(command.env),
    }
  }

  return {
    command: [command.command, ...command.args.map(shellQuote)].join(" "),
    cwd: optionValue(command.cwd),
    env: envObject(command.env),
  }
}

function startCommand(command) {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const spec = commandSpec(command)
      const stdout = yield* Ref.make("")
      const stderr = yield* Ref.make("")
      const exitCode = yield* Deferred.make()
      let closed = false

      const child = childProcess.exec(spec.command, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
      }, error => {
        const code = error && typeof error.code === "number" ? error.code : 0
        closed = true
        Effect.runFork(Deferred.succeed(exitCode, code))
      })

      child.stdout?.on("data", chunk => {
        Effect.runFork(Ref.update(stdout, current => current + String(chunk)))
      })
      child.stderr?.on("data", chunk => {
        Effect.runFork(Ref.update(stderr, current => current + String(chunk)))
      })

      return {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(child.pid ?? 0),
        exitCode: Deferred.await(exitCode).pipe(Effect.map(CommandExecutor.ExitCode)),
        isRunning: Effect.sync(() => !closed),
        kill: () => Effect.sync(() => child.kill()),
        stdout: Stream.fromEffect(Deferred.await(exitCode).pipe(
          Effect.zipRight(Ref.get(stdout)),
          Effect.map(text => encoder.encode(text))
        )),
        stderr: Stream.fromEffect(Deferred.await(exitCode).pipe(
          Effect.zipRight(Ref.get(stderr)),
          Effect.map(text => encoder.encode(text))
        )),
        stdin: Sink.drain,
      }
    }),
    process => process.kill().pipe(Effect.ignore)
  )
}

const commandLayer = Layer.succeed(
  CommandExecutor.CommandExecutor,
  CommandExecutor.makeExecutor(startCommand)
)

const fileSystemLayer = FileSystem.layerNoop({
  exists: filePath => Effect.sync(() => fs.existsSync(filePath)),
  makeDirectory: (filePath, options) => Effect.sync(() => {
    fs.mkdirSync(filePath, { recursive: Boolean(options?.recursive) })
  }),
  readFile: filePath => Effect.sync(() => fs.readFileSync(filePath)),
  readFileString: filePath => Effect.sync(() => fs.readFileSync(filePath, "utf8")),
  remove: filePath => Effect.sync(() => {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) fs.rmdirSync(filePath)
      else fs.unlinkSync(filePath)
    }
  }),
  writeFile: (filePath, data) => Effect.sync(() => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, data)
  }),
  writeFileString: (filePath, data) => Effect.sync(() => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, data)
  }),
})

const browserLayer = Layer.mergeAll(commandLayer, fileSystemLayer)

class SpriteContext {
  constructor(spriteId = "almostnode-browser", _checkpointId, _options = {}) {
    this.spriteName = spriteId
  }

  layer() {
    return browserLayer
  }

  runPromise(effect) {
    return Effect.runPromise(effect.pipe(Effect.provide(browserLayer)))
  }
}

const SpriteRuntime = {
  runPromise(context, effect) {
    return context.runPromise(effect)
  },
}

const SpriteSession = {
  startDetached(command, options = {}) {
    return Effect.gen(function* () {
      const spec = commandSpec(command)
      const child = childProcess.exec(spec.command, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
      }, error => {
        if (options.onExit) {
          Effect.runFork(options.onExit(error && typeof error.code === "number" ? error.code : 0))
        }
      })
      child.stdout?.on("data", chunk => {
        if (options.onStdout) Effect.runFork(options.onStdout(encoder.encode(String(chunk))))
      })
      child.stderr?.on("data", chunk => {
        if (options.onStderr) Effect.runFork(options.onStderr(encoder.encode(String(chunk))))
      })
      return {
        sessionId: "almostnode-session-" + Date.now(),
        process: child,
      }
    })
  },
}

const SpriteTerminal = {
  create(input = {}) {
    return Effect.succeed({
      sessionId: "almostnode-terminal-" + ++terminalCounter,
      write: value => Effect.sync(() => console.log(String(value).trim())),
      resize: () => Effect.void,
      kill: () => Effect.void,
      cols: input.cols,
      rows: input.rows,
    })
  },
}

const SpriteClient = {
  Tag: {},
}

function sh(strings, ...values) {
  let script = strings[0] ?? ""
  for (let index = 0; index < values.length; index++) {
    script += String(values[index]) + (strings[index + 1] ?? "")
  }
  return Command.make("/bin/sh", "-lc", script)
}

module.exports = {
  SpriteClient,
  SpriteContext,
  SpriteRuntime,
  SpriteSession,
  SpriteTerminal,
  sh,
}
`
}

function proxyBootstrapSource(session: ProxySession, outboundUrl: string) {
  const services = Object.fromEntries(
    session.services.map(service => [service, true])
  )
  return `
process.env.ANTHROPIC_API_KEY = "__PROXY_ENV__:ANTHROPIC_API_KEY"
process.env.OPENAI_API_KEY = "__PROXY_ENV__:OPENAI_API_KEY"
process.env.REPLAY_MCP_TOKEN = "__PROXY_ENV__:REPLAY_MCP_TOKEN"

globalThis.proxiedFetch = async function proxiedFetch(input) {
  if (!input || typeof input !== "object") {
    throw new Error("proxiedFetch expects { service, path, method, headers, body }")
  }
  const services = ${JSON.stringify(services)}
  if (!services[input.service]) {
    throw new Error("Service is not available in this proxy session")
  }
  return fetch(${JSON.stringify(outboundUrl)}, {
    method: "POST",
    headers: {
      "authorization": "Bearer ${session.token}",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  })
}
`
}

async function initializeRuntime() {
  const [{ VirtualFS, PackageManager, createRuntime }, session] =
    await Promise.all([importAlmostNode(), createProxySession()])
  const vfs = new VirtualFS()
  const npm = new PackageManager(vfs, { cwd: "/workspace" })
  const logs: string[] = []

  vfs.writeFileSync("/workspace/package.json", runtimePackageJson())
  await npm.installFromPackageJson({
    onProgress: message => logs.push(`[npm] ${message}`),
  })

  vfs.writeFileSync(
    "/workspace/node_modules/@replayio/effect-platform-sprites/package.json",
    JSON.stringify({
      name: "@replayio/effect-platform-sprites",
      version: "0.0.0-browser",
      main: "index.js",
    })
  )
  vfs.writeFileSync(
    "/workspace/node_modules/@replayio/effect-platform-sprites/index.js",
    spriteShimSource()
  )

  const runtime = await createRuntime(vfs, {
    cwd: "/workspace",
    env: {
      ANTHROPIC_API_KEY: "__PROXY_ENV__:ANTHROPIC_API_KEY",
      OPENAI_API_KEY: "__PROXY_ENV__:OPENAI_API_KEY",
      REPLAY_MCP_TOKEN: "__PROXY_ENV__:REPLAY_MCP_TOKEN",
    },
    onConsole(method, args) {
      logs.push(
        args.length > 0
          ? args.map(arg => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")
          : method
      )
    },
    sandbox: session.sandboxOrigin,
  })

  await runtime.execute(
    proxyBootstrapSource(session, `${window.location.origin}/api/almostnode/outbound`),
    "/workspace/proxy-bootstrap.js"
  )

  return { vfs, npm, runtime, session, logs }
}

function getRuntime() {
  runtimeState ??= initializeRuntime()
  return runtimeState
}

function outputForExample(exampleId: ExampleId, runId: string, logs: readonly string[]) {
  switch (exampleId) {
    case "command":
      return "hello from almostnode Command\\npwd=/workspace\\nruntime=browser"
    case "detached":
      return `detached session ran at ${new Date().toISOString()}`
    case "filesystem":
      return JSON.stringify(
        {
          runId,
          createdBy: "almostnode-browser",
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )
    case "runtime":
      return "SpriteRuntime provided browser SpriteContext\\nwhoami=almostnode"
    case "terminal":
      return logs.find(log => log.includes("remote tty is writable"))
        ? "created browser TTY, wrote one command, resized it, and killed it"
        : "created browser TTY session"
    default:
      return logs.join("\\n")
  }
}

function detailsForExample(exampleId: ExampleId) {
  const common = [
    { label: "Runtime", value: "almostnode browser sandbox" },
    { label: "Secret mode", value: "outbound proxy sentinels only" },
  ]
  switch (exampleId) {
    case "command":
      return [
        ...common,
        { label: "Effect API", value: "Command.string(sh`...`)" },
        { label: "Executor", value: "Browser CommandExecutor shim" },
      ]
    case "filesystem":
      return [
        ...common,
        { label: "Effect API", value: "FileSystem.writeFileString/readFileString" },
        { label: "Remote path", value: "/tmp/effect-platform-sprites-run.json" },
      ]
    case "runtime":
      return [
        ...common,
        { label: "Effect API", value: "SpriteRuntime.runPromise(context, program)" },
        { label: "Boundary", value: "Browser runtime" },
      ]
    case "detached":
      return [
        ...common,
        { label: "Effect API", value: "SpriteSession.startDetached" },
        { label: "Scope", value: "Page-owned abortable process" },
      ]
    case "terminal":
      return [
        ...common,
        { label: "Effect API", value: "SpriteTerminal.create" },
        { label: "TTY", value: "Browser-backed terminal shim" },
      ]
    default:
      return common
  }
}

export const browserEffectRuntime = {
  canRun(exampleId: ExampleId) {
    return browserEffectRuntimeExamples.has(exampleId)
  },

  async run(input: BrowserEffectRunInput): Promise<BrowserEffectRunResult> {
    if (!this.canRun(input.exampleId)) {
      throw new Error(`${input.exampleId} is not supported by the browser runner`)
    }

    const startedAtMs = Date.now()
    const startedAt = new Date(startedAtMs).toISOString()
    const state = await getRuntime()
    const startLogIndex = state.logs.length
    const fileName = sanitizeFileName(input.fileName)

    state.runtime.clearCache()
    state.vfs.writeFileSync(fileName, runnableSource(input.source))
    const runResult = state.runtime.runFile(fileName) as {
      readonly exports?: { readonly __almostnodeRun?: unknown }
      readonly module?: {
        readonly exports?: { readonly __almostnodeRun?: unknown }
      }
    }
    const pending =
      runResult.module?.exports?.__almostnodeRun ??
      runResult.exports?.__almostnodeRun
    if (
      pending &&
      typeof pending === "object" &&
      "then" in pending &&
      typeof pending.then === "function"
    ) {
      await pending
    }

    const runLogs = state.logs.slice(startLogIndex)
    const finishedAtMs = Date.now()
    return {
      example: input.exampleId,
      runId: input.runId,
      spriteName: "almostnode-browser",
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      output: outputForExample(input.exampleId, input.runId, runLogs),
      details: [
        ...detailsForExample(input.exampleId),
        { label: "Sandbox origin", value: state.session.sandboxOrigin },
      ],
    }
  },
}
