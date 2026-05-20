import { PageShell, SectionHeading } from "@/components/section-heading"
import { ClaudePrintRunner } from "@/components/remote-claude-runner"

export const metadata = {
  title: "Claude — print mode · Effect Platform Sprites",
}

export default function Page() {
  return (
    <PageShell>
      <SectionHeading eyebrow="Claude example" title="claude -p">
        Send a single prompt to Claude Code running inside a remote Sprite and
        capture the output here.
      </SectionHeading>
      <ClaudePrintRunner />
    </PageShell>
  )
}
