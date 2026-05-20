import {
  createRemoteAgentSession,
  parseAgentSessionInput,
  type AgentSessionInput,
  type AgentSessionMode,
  type AgentSessionResult,
} from "@/lib/remote-agent-session"

export type ClaudeSessionMode = AgentSessionMode
export type ClaudeSessionInput = Omit<AgentSessionInput, "agentId">
export type ClaudeSessionResult = AgentSessionResult

export function parseClaudeSessionInput(body: unknown): AgentSessionInput {
  const input = parseAgentSessionInput(body)
  return { ...input, agentId: "claude" }
}

export function createRemoteClaudeSession(
  input: ClaudeSessionInput,
  origin: string
) {
  return createRemoteAgentSession({ ...input, agentId: "claude" }, origin)
}

export {
  ensureTerminalBridge,
  renderGhosttyWebTerminalPage,
  terminalRouteBase,
  validateTerminalAccess,
} from "@/lib/remote-agent-session"
