import { AgentInteractiveRunner } from "@/components/remote-claude-runner"
import { PageShell, SectionHeading } from "@/components/section-heading"

export const metadata = {
  title: "AI CLI — interactive · Effect Platform Sprites",
}

export default function Page() {
  return (
    <PageShell>
      <SectionHeading
        eyebrow="AI CLI example"
        title="Interactive agent terminal"
      >
        Start Codex, Claude Code, OpenCode, Gemini CLI, or Pi in a remote Sprite
        TTY and drive it from the embedded terminal.
      </SectionHeading>
      <AgentInteractiveRunner />
    </PageShell>
  )
}
