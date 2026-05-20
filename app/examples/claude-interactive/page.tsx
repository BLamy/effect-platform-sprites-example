import { PageShell, SectionHeading } from "@/components/section-heading"
import { ClaudeInteractiveRunner } from "@/components/remote-claude-runner"

export const metadata = {
  title: "Claude — interactive · Effect Platform Sprites",
}

export default function Page() {
  return (
    <PageShell>
      <SectionHeading eyebrow="Claude example" title="Interactive Claude">
        Start Claude Code in a remote Sprite TTY and drive it from the embedded
        terminal.
      </SectionHeading>
      <ClaudeInteractiveRunner />
    </PageShell>
  )
}
