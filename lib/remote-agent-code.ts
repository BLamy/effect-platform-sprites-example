export const AGENT_IDS = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "pi",
] as const

export type AgentId = (typeof AGENT_IDS)[number]
export type AgentSessionMode = "print" | "interactive"

export interface AgentSessionCommandInput {
  readonly agentId: AgentId
  readonly mode: AgentSessionMode
  readonly prompt?: string
}

export interface AgentSessionCommand {
  readonly script: string
  readonly displayCommand: string
  readonly stdin?: string
  readonly tty: boolean
}

export type AgentSessionEnv = Record<string, string>

export interface RemoteAgentEffectCodeInput
  extends AgentSessionCommandInput {
  readonly cliVersion: string
  readonly cwd?: string
  readonly cols: number
  readonly rows: number
}

interface AgentSpec {
  readonly id: AgentId
  readonly label: string
  readonly commandLabel: string
  readonly npmPackage: string
  readonly defaultVersion: string
  readonly binary: string
  readonly requiredEnv?: readonly string[]
  readonly requiredAnyEnv?: readonly string[]
  readonly optionalEnv?: readonly string[]
  readonly printCommand: (promptVariable: string) => string
  readonly interactiveCommand: string
}

const COMMON_PROVIDER_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENCODE_API_KEY",
  "OPENROUTER_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
] as const

export const agentSpecs: Record<AgentId, AgentSpec> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    commandLabel: "claude -p",
    npmPackage: "@anthropic-ai/claude-code",
    defaultVersion: "2.1.121",
    binary: "claude",
    requiredEnv: ["ANTHROPIC_API_KEY"],
    printCommand: (promptVariable) => `claude -p "$${promptVariable}"`,
    interactiveCommand: "claude",
  },
  codex: {
    id: "codex",
    label: "Codex",
    commandLabel: "codex exec",
    npmPackage: "@openai/codex",
    defaultVersion: "latest",
    binary: "codex",
    requiredEnv: ["OPENAI_API_KEY"],
    printCommand: (promptVariable) =>
      [
        "codex exec",
        "--skip-git-repo-check",
        "--ask-for-approval never",
        "--sandbox workspace-write",
        "--color never",
        `"$${promptVariable}"`,
      ].join(" "),
    interactiveCommand:
      "codex --ask-for-approval never --sandbox workspace-write",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    commandLabel: "opencode run",
    npmPackage: "opencode-ai",
    defaultVersion: "latest",
    binary: "opencode",
    optionalEnv: COMMON_PROVIDER_KEYS,
    printCommand: (promptVariable) => `opencode run "$${promptVariable}"`,
    interactiveCommand: "opencode",
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    commandLabel: "gemini -p",
    npmPackage: "@google/gemini-cli",
    defaultVersion: "latest",
    binary: "gemini",
    requiredAnyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    printCommand: (promptVariable) => `gemini -p "$${promptVariable}"`,
    interactiveCommand: "gemini",
  },
  pi: {
    id: "pi",
    label: "Pi",
    commandLabel: "pi -p",
    npmPackage: "@earendil-works/pi-coding-agent",
    defaultVersion: "latest",
    binary: "pi",
    requiredAnyEnv: COMMON_PROVIDER_KEYS,
    printCommand: (promptVariable) => `pi -p "$${promptVariable}"`,
    interactiveCommand: "pi",
  },
}

export const agentOptions = AGENT_IDS.map((agentId) => agentSpecs[agentId])

export const AGENT_CLI_DEFAULT_VERSIONS = Object.fromEntries(
  AGENT_IDS.map((agentId) => [agentId, agentSpecs[agentId].defaultVersion])
) as Record<AgentId, string>

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && AGENT_IDS.includes(value as AgentId)
}

export function getAgentSpec(agentId: AgentId) {
  return agentSpecs[agentId]
}

export function requiredSecretNames(agentId: AgentId) {
  return [...(getAgentSpec(agentId).requiredEnv ?? [])]
}

export function candidateSecretNames(agentId: AgentId) {
  return [...(getAgentSpec(agentId).requiredAnyEnv ?? [])]
}

export function optionalSecretNames(agentId: AgentId) {
  return [...(getAgentSpec(agentId).optionalEnv ?? [])]
}

function installPackageSpec(spec: AgentSpec, cliVersion: string) {
  return `${spec.npmPackage}@${cliVersion}`
}

function baseEnv(input: AgentSessionCommandInput): AgentSessionEnv {
  if (input.mode === "print") {
    return {
      CI: "1",
      NO_COLOR: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    }
  }

  return {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  }
}

export function buildAgentSessionCommand(
  input: AgentSessionCommandInput,
  cliVersion: string
) {
  const spec = getAgentSpec(input.agentId)
  const promptVariable = "AGENT_PROMPT"
  const packageSpec = installPackageSpec(spec, cliVersion)
  const installStep = [
    `echo "Installing ${spec.label} ${packageSpec}" >&2`,
    `npm install -g ${packageSpec} >&2`,
  ]

  if (input.mode === "print") {
    const command = spec.printCommand(promptVariable)
    return {
      script: [
        "set -euo pipefail",
        ...installStep,
        `${promptVariable}="$(cat)"`,
        `exec ${command}`,
      ].join("\n"),
      displayCommand: command,
      stdin: input.prompt ?? "",
      tty: false,
    } satisfies AgentSessionCommand
  }

  return {
    script: [
      "set -euo pipefail",
      ...installStep,
      `printf "\\n${spec.label} is ready. Type in the terminal below.\\n" >&2`,
      `exec ${spec.interactiveCommand}`,
    ].join("\n"),
    displayCommand: spec.interactiveCommand,
    tty: true,
  } satisfies AgentSessionCommand
}

export function buildAgentSessionEnv(
  input: AgentSessionCommandInput,
  secrets: Record<string, string>
): AgentSessionEnv {
  return {
    ...baseEnv(input),
    ...secrets,
  }
}

function literal(value: unknown) {
  return JSON.stringify(value)
}

function shellTemplate(value: string) {
  return value.replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
}

function effectEnv(input: RemoteAgentEffectCodeInput) {
  const staticEnv = baseEnv(input)
  const secretEntries = [
    ...requiredSecretNames(input.agentId).map((key) => [key, true] as const),
    ...candidateSecretNames(input.agentId).map((key) => [key, false] as const),
    ...optionalSecretNames(input.agentId).map((key) => [key, false] as const),
  ]
  const uniqueSecretEntries = Array.from(
    new Map(secretEntries.map(([key, required]) => [key, required])).entries()
  )
  const objectLines = [
    ...Object.entries(staticEnv).map(
      ([key, value]) => `    ${key}: ${literal(value)},`
    ),
    ...uniqueSecretEntries.map(([key, required]) =>
      required
        ? `    ${key}: process.env.${key}!,`
        : `    ${key}: process.env.${key},`
    ),
  ]

  return `Object.fromEntries(
  Object.entries({
${objectLines.join("\n")}
  }).filter(([, value]) => value)
) as Record<string, string>`
}

export function remoteAgentEffectCode(input: RemoteAgentEffectCodeInput) {
  const sessionCommand = buildAgentSessionCommand(input, input.cliVersion)
  const spec = getAgentSpec(input.agentId)
  const cwdLine = input.cwd ? `cwd: ${literal(input.cwd)},` : "cwd: undefined,"
  const ttySize = sessionCommand.tty
    ? `\n    cols: ${input.cols},\n    rows: ${input.rows},`
    : ""
  const stdinLine =
    sessionCommand.stdin === undefined
      ? ""
      : `\nprocess.stdin.end(${literal(sessionCommand.stdin)})`

  return `import { Effect } from "effect"
import { SpriteContext, sh } from "@replayio/effect-platform-sprites"

const context = new SpriteContext("${input.agentId}-session", undefined, {
  createIfMissing: true,
  namePrefix: "${input.agentId}-session",
  token: process.env.SPRITES_TOKEN!,
})

const shell = sh\`${shellTemplate(sessionCommand.script)}\`
const env = ${effectEnv(input)}

const sprite = await Effect.runPromise(context.resolveSprite())
const process = sprite.spawn("/bin/sh", ["-lc", shell], {
  ${cwdLine}
  env,
  detachable: true,
  tty: ${String(sessionCommand.tty)},${ttySize}
})${stdinLine}

// The API also waits for spawn/session_id, captures output for ${spec.commandLabel},
// and returns a ghostty-web terminal URL for the interactive TTY.`
}
