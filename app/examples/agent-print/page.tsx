import { AgentPrintRunner } from "@/components/remote-claude-runner"
import { PageShell, SectionHeading } from "@/components/section-heading"

export const metadata = {
  title: "AI CLI — print mode · Effect Platform Sprites",
}

export default function Page() {
  return (
    <PageShell>
      <SectionHeading eyebrow="AI CLI example" title="One-shot agent command">
        Send a single prompt to Codex, Claude Code, OpenCode, Gemini CLI, or Pi
        running inside a remote Sprite and capture the output here.
      </SectionHeading>
      <AgentPrintRunner />
    </PageShell>
  )
}
