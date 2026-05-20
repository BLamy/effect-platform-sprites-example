import { SpritesClient, type SpriteCommand } from "@fly/sprites"
import { SpriteContext } from "@replayio/effect-platform-sprites"
import { Effect } from "effect"
import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import {
  buildAgentSessionCommand,
  buildAgentSessionEnv,
  getAgentSpec,
  isAgentId,
  optionalSecretNames,
  type AgentId,
  type AgentSessionMode,
} from "@/lib/remote-agent-code"

export type { AgentId, AgentSessionMode } from "@/lib/remote-agent-code"

export interface AgentSessionInput {
  readonly agentId: AgentId
  readonly mode: AgentSessionMode
  readonly prompt?: string
  readonly spriteName?: string
  readonly cwd?: string
  readonly cols: number
  readonly rows: number
}

interface AgentTerminalBridge {
  readonly command: SpriteCommand
  readonly output: EventEmitter
}

export interface AgentSessionResult {
  readonly agentId: AgentId
  readonly agentLabel: string
  readonly mode: AgentSessionMode
  readonly status: "completed" | "started"
  readonly spriteName: string
  readonly sessionId?: string
  readonly command: string
  readonly tty: boolean
  readonly env: Record<string, string>
  readonly durationMs?: number
  readonly exitCode?: number
  readonly output?: string
  readonly terminalUrl?: string
}

type AgentGlobalStore = {
  readonly terminalTokens: Map<string, string>
  readonly terminalBridges: Map<string, Promise<AgentTerminalBridge>>
}

const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30
const GHOSTTY_WEB_VERSION = "0.4.0"
const MAX_CAPTURED_OUTPUT_LENGTH = 80_000
const PRINT_SESSION_TIMEOUT_MS = 180_000
const VERSION_ENV_BY_AGENT = {
  claude: "CLAUDE_CODE_VERSION",
  codex: "CODEX_CLI_VERSION",
  opencode: "OPENCODE_CLI_VERSION",
  gemini: "GEMINI_CLI_VERSION",
  pi: "PI_CLI_VERSION",
} satisfies Record<AgentId, string>

const globalStore = globalThis as typeof globalThis & {
  __effectPlatformSpritesAgentStore?: AgentGlobalStore
}

const store =
  globalStore.__effectPlatformSpritesAgentStore ??
  (globalStore.__effectPlatformSpritesAgentStore = {
    terminalTokens: new Map<string, string>(),
    terminalBridges: new Map<string, Promise<AgentTerminalBridge>>(),
  })

function terminalKey(spriteName: string, sessionId: string) {
  return `${spriteName}:${sessionId}`
}

function stringField(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function integerField(value: unknown, fieldName: string, defaultValue: number) {
  if (value === undefined) {
    return defaultValue
  }
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${fieldName} must be a positive integer`)
  }
  return number
}

export function parseAgentSessionInput(body: unknown): AgentSessionInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object")
  }

  const record = body as Record<string, unknown>
  const agentId = record.agentId ?? record.agent ?? "claude"
  if (!isAgentId(agentId)) {
    throw new Error("agentId must be one of claude, codex, opencode, gemini, pi")
  }

  const mode = record.mode ?? "print"
  if (mode !== "print" && mode !== "interactive") {
    throw new Error("mode must be either 'print' or 'interactive'")
  }

  const prompt = stringField(record.prompt, "prompt")
  if (mode === "print" && !prompt) {
    throw new Error("prompt is required when mode is 'print'")
  }

  return {
    agentId,
    mode,
    prompt,
    spriteName: stringField(record.spriteName, "spriteName"),
    cwd: stringField(record.cwd, "cwd"),
    cols: integerField(record.cols, "cols", DEFAULT_COLS),
    rows: integerField(record.rows, "rows", DEFAULT_ROWS),
  }
}

function envLocalPaths() {
  const paths: string[] = []
  let current = process.cwd()

  while (true) {
    paths.push(path.join(current, ".env.local"))
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return paths
}

function parseEnvLocal(contents: string) {
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

function getOptionalEnvValue(variable: string) {
  for (const envPath of envLocalPaths()) {
    if (!existsSync(envPath)) {
      continue
    }
    const value = parseEnvLocal(readFileSync(envPath, "utf8"))
      .get(variable)
      ?.trim()
    if (value) {
      return { value, source: envPath }
    }
  }

  const value = process.env[variable]?.trim()
  if (value) {
    return { value, source: "process.env" }
  }

  return undefined
}

function getRequiredEnvValue(variable: string) {
  const resolved = getOptionalEnvValue(variable)
  if (!resolved) {
    throw new Error(`${variable} is required in .env.local or process.env`)
  }
  return resolved
}

function findPackageJsonWithPackage(packageName: string) {
  let current = process.cwd()

  while (true) {
    const packagePath = path.join(current, "package.json")
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const version =
        packageJson.dependencies?.[packageName] ??
        packageJson.devDependencies?.[packageName]
      if (version) {
        return version.trim()
      }
    }

    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  throw new Error(`Could not find ${packageName} in package.json dependencies`)
}

function pinnedPackageVersion(packageName: string) {
  const version = findPackageJsonWithPackage(packageName)
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `${packageName} must be pinned to an exact x.y.z version, got ${JSON.stringify(
        version
      )}`
    )
  }
  return version
}

function cliVersionFor(agentId: AgentId) {
  const override = getOptionalEnvValue(VERSION_ENV_BY_AGENT[agentId])?.value
  if (override) {
    return override
  }

  const spec = getAgentSpec(agentId)
  if (agentId === "claude") {
    return pinnedPackageVersion(spec.npmPackage)
  }

  return spec.defaultVersion
}

function resolveAgentSecrets(agentId: AgentId) {
  const spec = getAgentSpec(agentId)
  const secrets: Record<string, string> = {}
  const sources: Record<string, string> = {}
  const seen = new Set<string>()

  for (const variable of spec.requiredEnv ?? []) {
    seen.add(variable)
    const resolved = getRequiredEnvValue(variable)
    secrets[variable] = resolved.value
    sources[variable] = resolved.source
  }

  const requiredAny = spec.requiredAnyEnv ?? []
  if (requiredAny.length > 0) {
    const resolvedAny = requiredAny
      .filter((variable) => !seen.has(variable))
      .map((variable) => [variable, getOptionalEnvValue(variable)] as const)
      .filter((entry): entry is readonly [
        string,
        { readonly value: string; readonly source: string },
      ] => Boolean(entry[1]))

    if (resolvedAny.length === 0) {
      throw new Error(
        `${spec.label} requires one of ${requiredAny.join(
          ", "
        )} in .env.local or process.env`
      )
    }

    for (const [variable, resolved] of resolvedAny) {
      seen.add(variable)
      secrets[variable] = resolved.value
      sources[variable] = resolved.source
    }
  }

  for (const variable of optionalSecretNames(agentId)) {
    if (seen.has(variable)) {
      continue
    }
    seen.add(variable)
    const resolved = getOptionalEnvValue(variable)
    if (resolved) {
      secrets[variable] = resolved.value
      sources[variable] = resolved.source
    }
  }

  return { secrets, sources }
}

function describeEnvSources(sources: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(sources).map(([key, source]) => [key, `loaded from ${source}`])
  )
}

function createTerminalToken(spriteName: string, sessionId: string) {
  const token = randomUUID()
  store.terminalTokens.set(terminalKey(spriteName, sessionId), token)
  return token
}

function buildTerminalUrl(
  origin: string,
  spriteName: string,
  sessionId: string
) {
  const token = createTerminalToken(spriteName, sessionId)
  const url = new URL(
    `/api/agents/session/${encodeURIComponent(spriteName)}/${encodeURIComponent(
      sessionId
    )}/terminal`,
    origin
  )
  url.searchParams.set("token", token)
  return url.toString()
}

function appendCapturedOutput(current: string, chunk: Uint8Array) {
  const next = current + new TextDecoder().decode(chunk)
  if (next.length <= MAX_CAPTURED_OUTPUT_LENGTH) {
    return next
  }
  return next.slice(next.length - MAX_CAPTURED_OUTPUT_LENGTH)
}

function timeoutAfter(ms: number) {
  return new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), ms)
  })
}

function optionalSessionId(
  sessionId: Promise<string>,
  timeoutMs = 500
): Promise<string | undefined> {
  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), timeoutMs)
  })
  return Promise.race([sessionId.catch(() => undefined), timeout])
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

function sessionIdFromMessage(message: unknown) {
  const parsed = parseSpriteMessage(message)
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "session_id" in parsed &&
    typeof parsed.session_id === "string"
  ) {
    return parsed.session_id
  }

  return undefined
}

function waitForSpawn(command: SpriteCommand) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      command.off("spawn", onSpawn)
      command.off("error", onError)
    }
    const onSpawn = () => {
      cleanup()
      resolve()
    }
    const onError = (error: unknown) => {
      cleanup()
      reject(error)
    }
    command.once("spawn", onSpawn)
    command.once("error", onError)
  })
}

function waitForSessionId(command: SpriteCommand, timeoutMs = 15_000) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Sprite session started without reporting a session_id"))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      command.off("message", onMessage)
      command.off("error", onError)
    }
    const onMessage = (message: unknown) => {
      const sessionId = sessionIdFromMessage(message)
      if (!sessionId) {
        return
      }
      cleanup()
      resolve(sessionId)
    }
    const onError = (error: unknown) => {
      cleanup()
      reject(error)
    }
    command.on("message", onMessage)
    command.once("error", onError)
  })
}

function wireTerminalBridge(
  spriteName: string,
  sessionId: string,
  command: SpriteCommand
) {
  const key = terminalKey(spriteName, sessionId)
  const existing = store.terminalBridges.get(key)
  if (existing) {
    return existing
  }

  const output = new EventEmitter()
  command.stdout.on("data", (chunk) => output.emit("data", Buffer.from(chunk)))
  command.stderr.on("data", (chunk) => output.emit("data", Buffer.from(chunk)))
  command.on("exit", (code) => {
    output.emit("exit", code)
    store.terminalBridges.delete(key)
    store.terminalTokens.delete(key)
  })
  command.on("error", (error) => {
    output.emit("error", error)
    store.terminalBridges.delete(key)
    store.terminalTokens.delete(key)
  })

  const bridge = Promise.resolve({ command, output })
  store.terminalBridges.set(key, bridge)
  return bridge
}

function spriteNameFor(input: AgentSessionInput) {
  return (
    input.spriteName ??
    `${input.agentId}-session-${randomUUID().replace(/-/g, "").slice(0, 16)}`
  )
}

function toCommand(input: AgentSessionInput, secrets: Record<string, string>) {
  const sessionCommand = buildAgentSessionCommand(
    input,
    cliVersionFor(input.agentId)
  )
  const env = buildAgentSessionEnv(input, secrets)
  return {
    command: "/bin/sh",
    args: ["-lc", sessionCommand.script],
    options: {
      cwd: input.cwd,
      env,
    },
    sessionCommand,
  }
}

export async function createRemoteAgentSession(
  input: AgentSessionInput,
  origin: string
) {
  const startedAt = Date.now()
  const { secrets, sources } = resolveAgentSecrets(input.agentId)
  const spritesToken = getRequiredEnvValue("SPRITES_TOKEN")
  const spriteName = spriteNameFor(input)
  const spec = getAgentSpec(input.agentId)
  const context = new SpriteContext(spriteName, undefined, {
    createIfMissing: true,
    namePrefix: `${input.agentId}-session`,
    token: spritesToken.value,
  })
  const { command, args, options, sessionCommand } = toCommand(input, secrets)
  const sprite = await Effect.runPromise(context.resolveSprite())
  const process = sprite.spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detachable: true,
    tty: sessionCommand.tty,
    cols: sessionCommand.tty ? input.cols : undefined,
    rows: sessionCommand.tty ? input.rows : undefined,
  }) as SpriteCommand
  const spawned = waitForSpawn(process)
  const sessionIdPromise = waitForSessionId(process)

  if (input.mode === "interactive") {
    const [, sessionId] = await Promise.all([spawned, sessionIdPromise])
    if (sessionCommand.stdin !== undefined) {
      process.stdin.end(sessionCommand.stdin)
    }
    wireTerminalBridge(spriteName, sessionId, process)
    const terminalUrl = buildTerminalUrl(origin, spriteName, sessionId)

    return {
      agentId: input.agentId,
      agentLabel: spec.label,
      mode: input.mode,
      status: "started",
      spriteName,
      sessionId,
      command: sessionCommand.displayCommand,
      tty: true,
      env: describeEnvSources(sources),
      terminalUrl,
    } satisfies AgentSessionResult
  }

  let output = ""
  let exitCode: number | undefined
  let resolveExit!: (code: number) => void
  let rejectExit!: (error: unknown) => void
  const exited = new Promise<number>((resolve, reject) => {
    resolveExit = resolve
    rejectExit = reject
  })

  process.stdout.on("data", (chunk) => {
    output = appendCapturedOutput(output, Buffer.from(chunk))
  })
  process.stderr.on("data", (chunk) => {
    output = appendCapturedOutput(output, Buffer.from(chunk))
  })
  process.on("exit", (code) => {
    exitCode = code
    resolveExit(code)
  })
  process.on("error", rejectExit)

  await spawned
  const sessionId = await optionalSessionId(sessionIdPromise)
  process.stdin.end(sessionCommand.stdin ?? "")

  const completed = await Promise.race([
    exited,
    timeoutAfter(PRINT_SESSION_TIMEOUT_MS),
  ])
  if (completed !== "timeout") {
    exitCode = completed
  }

  return {
    agentId: input.agentId,
    agentLabel: spec.label,
    mode: input.mode,
    status: completed === "timeout" ? "started" : "completed",
    spriteName,
    sessionId,
    command: sessionCommand.displayCommand,
    tty: false,
    env: describeEnvSources(sources),
    durationMs: Date.now() - startedAt,
    exitCode,
    output,
  } satisfies AgentSessionResult
}

function getTerminalToken(url: URL, request: Request) {
  return (
    url.searchParams.get("token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  )
}

export function validateTerminalAccess(input: {
  readonly request: Request
  readonly spriteName: string
  readonly sessionId: string
}) {
  const url = new URL(input.request.url)
  const expected = store.terminalTokens.get(
    terminalKey(input.spriteName, input.sessionId)
  )
  if (!expected || getTerminalToken(url, input.request) !== expected) {
    throw new Error("Terminal session not found")
  }
}

export async function ensureTerminalBridge(input: {
  readonly spriteName: string
  readonly sessionId: string
  readonly cols: number
  readonly rows: number
}) {
  const key = terminalKey(input.spriteName, input.sessionId)
  const existing = store.terminalBridges.get(key)
  if (existing) {
    return existing
  }

  const bridgePromise = (async () => {
    const spritesToken = getRequiredEnvValue("SPRITES_TOKEN")
    const client = new SpritesClient(spritesToken.value)
    const sprite = await client.getSprite(input.spriteName)
    const command = sprite.attachSession(input.sessionId, {
      tty: true,
      cols: input.cols,
      rows: input.rows,
    })
    const output = new EventEmitter()

    command.stdout.on("data", (chunk) =>
      output.emit("data", Buffer.from(chunk))
    )
    command.stderr.on("data", (chunk) =>
      output.emit("data", Buffer.from(chunk))
    )
    command.on("exit", (code) => {
      output.emit("exit", code)
      store.terminalBridges.delete(key)
      store.terminalTokens.delete(key)
    })
    command.on("error", (error) => {
      output.emit("error", error)
      store.terminalBridges.delete(key)
      store.terminalTokens.delete(key)
    })

    return { command, output }
  })()

  store.terminalBridges.set(key, bridgePromise)
  return bridgePromise
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return char
    }
  })
}

export function terminalRouteBase(spriteName: string, sessionId: string) {
  return `/api/agents/session/${encodeURIComponent(spriteName)}/${encodeURIComponent(
    sessionId
  )}`
}

export function renderGhosttyWebTerminalPage(input: {
  readonly spriteName: string
  readonly sessionId: string
  readonly token: string
}) {
  const routeBase = terminalRouteBase(input.spriteName, input.sessionId)
  const streamUrl = `${routeBase}/stream?token=${encodeURIComponent(input.token)}`
  const inputUrl = `${routeBase}/input?token=${encodeURIComponent(input.token)}`
  const resizeUrl = `${routeBase}/resize?token=${encodeURIComponent(input.token)}`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
    <title>AI CLI Sprite Terminal</title>
    <style>
      :root {
        color-scheme: dark;
        --background: #09090b;
        --foreground: #f4f4f5;
        --card: #111113;
        --muted: #27272a;
        --muted-foreground: #a1a1aa;
        --border: #27272a;
        --primary: #10b981;
        --radius: 8px;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        min-height: 100dvh;
        overflow: hidden;
        overscroll-behavior: none;
        background: var(--background);
        color: var(--foreground);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .page { display: flex; min-height: 100dvh; padding: clamp(0px, 1.8vw, 16px); }
      .terminal-card {
        display: flex;
        min-width: 0;
        min-height: 0;
        width: 100%;
        flex: 1 1 auto;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--card);
      }
      .toolbar {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 52px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--border);
      }
      .title-group { display: flex; min-width: 0; align-items: center; gap: 10px; }
      .status-dot {
        width: 10px;
        height: 10px;
        flex: 0 0 auto;
        border-radius: 999px;
        background: var(--primary);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary), transparent 84%);
      }
      .title-copy { min-width: 0; }
      h1 {
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 15px;
        font-weight: 600;
        line-height: 20px;
      }
      .session-meta {
        margin: 0;
        overflow: hidden;
        color: var(--muted-foreground);
        font-size: 12px;
        line-height: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .badge {
        display: inline-flex;
        min-height: 24px;
        align-items: center;
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 2px 8px;
        background: var(--muted);
        color: var(--muted-foreground);
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
      }
      .terminal-frame { min-height: 0; flex: 1 1 auto; background: #101216; }
      #terminal { width: 100%; height: 100%; padding: 12px; }
      @media (max-width: 640px) {
        .page { padding: 0; }
        .terminal-card { border-inline: 0; border-radius: 0; }
        .toolbar { min-height: 48px; padding: max(8px, env(safe-area-inset-top)) 12px 8px; }
        .session-meta { display: none; }
        .badge { min-height: 22px; padding-inline: 6px; font-size: 11px; }
        #terminal { padding: 8px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="terminal-card" aria-label="AI CLI Sprite Terminal">
        <header class="toolbar">
          <div class="title-group">
            <span class="status-dot" aria-hidden="true"></span>
            <div class="title-copy">
              <h1>AI CLI Sprite Terminal</h1>
              <p class="session-meta">${escapeHtml(input.spriteName)} / ${escapeHtml(input.sessionId)}</p>
            </div>
          </div>
          <span class="badge">ghostty-web</span>
        </header>
        <div class="terminal-frame">
          <div id="terminal"></div>
        </div>
      </section>
    </main>
    <script type="module">
      import { init, Terminal, FitAddon } from "https://esm.sh/ghostty-web@${GHOSTTY_WEB_VERSION}";

      const streamUrl = ${JSON.stringify(streamUrl)};
      const inputUrl = ${JSON.stringify(inputUrl)};
      const resizeUrl = ${JSON.stringify(resizeUrl)};

      await init();

      const isSmallViewport = () => window.matchMedia("(max-width: 640px)").matches;
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "Menlo, Monaco, Consolas, monospace",
        fontSize: isSmallViewport() ? 12 : 14,
        theme: {
          background: "#101216",
          foreground: "#d8dee9",
          cursor: "#88c0d0",
          selectionBackground: "#3b4252",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(document.getElementById("terminal"));
      term.focus();
      document.getElementById("terminal")?.addEventListener("pointerdown", () => term.focus());

      const decodeBase64 = value => {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      };

      const resize = () => {
        fit.fit();
        fetch(resizeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols: term.cols, rows: term.rows }),
        }).catch(() => {});
      };

      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(document.getElementById("terminal"));
      window.addEventListener("resize", resize);
      setTimeout(resize, 50);

      term.onData(data => {
        fetch(inputUrl, { method: "POST", body: data }).catch(() => {});
      });

      const connect = () => {
        const url = new URL(streamUrl, window.location.origin);
        url.searchParams.set("cols", String(term.cols));
        url.searchParams.set("rows", String(term.rows));
        const events = new EventSource(url);
        events.addEventListener("data", event => {
          term.write(decodeBase64(event.data));
        });
        events.addEventListener("exit", event => {
          term.write("\\r\\n\\x1b[2mProcess exited with code " + event.data + ".\\x1b[0m\\r\\n");
          events.close();
        });
        events.addEventListener("terminal-error", event => {
          term.write("\\r\\n\\x1b[31m" + new TextDecoder().decode(decodeBase64(event.data)) + "\\x1b[0m\\r\\n");
          events.close();
        });
        events.onerror = () => {
          term.write("\\r\\n\\x1b[31mTerminal stream disconnected.\\x1b[0m\\r\\n");
          events.close();
        };
      };

      connect();
    </script>
  </body>
</html>`
}
