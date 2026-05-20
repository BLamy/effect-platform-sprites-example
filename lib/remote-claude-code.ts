import {
  AGENT_CLI_DEFAULT_VERSIONS,
  buildAgentSessionCommand,
  buildAgentSessionEnv,
  remoteAgentEffectCode,
  type AgentSessionCommand,
  type AgentSessionEnv,
  type AgentSessionMode,
  type RemoteAgentEffectCodeInput,
} from "@/lib/remote-agent-code"

export type ClaudeSessionMode = AgentSessionMode

export interface ClaudeSessionCommandInput {
  readonly mode: ClaudeSessionMode
  readonly prompt?: string
}

export type ClaudeSessionCommand = AgentSessionCommand
export type ClaudeSessionEnv = AgentSessionEnv

export interface RemoteClaudeEffectCodeInput
  extends ClaudeSessionCommandInput {
  readonly claudeCodeVersion: string
  readonly cwd?: string
  readonly cols: number
  readonly rows: number
}

export function buildClaudeSessionCommand(
  input: ClaudeSessionCommandInput,
  claudeCodeVersion: string
) {
  return buildAgentSessionCommand(
    { ...input, agentId: "claude" },
    claudeCodeVersion
  )
}

export function buildClaudeSessionEnv(
  input: ClaudeSessionCommandInput,
  anthropicApiKey: string
): ClaudeSessionEnv {
  return buildAgentSessionEnv(
    { ...input, agentId: "claude" },
    { ANTHROPIC_API_KEY: anthropicApiKey }
  )
}

export function remoteClaudeEffectCode(input: RemoteClaudeEffectCodeInput) {
  return remoteAgentEffectCode({
    ...input,
    agentId: "claude",
    cliVersion:
      input.claudeCodeVersion ?? AGENT_CLI_DEFAULT_VERSIONS.claude,
  } satisfies RemoteAgentEffectCodeInput)
}
