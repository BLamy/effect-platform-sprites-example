import { PrReviewRunner } from "@/components/pr-review-runner"
import { PageShell, SectionHeading } from "@/components/section-heading"

export const metadata = {
  title: "PR comment bot · Effect Platform Sprites",
}

export default function Page() {
  return (
    <PageShell>
      <SectionHeading eyebrow="Bot example" title="PR comment bot">
        Trigger the local Replay PR comment bot flow, rebuild the sandbox Sprite
        script when needed, purge stale sandbox jobs, and inspect the Effect
        trace for the run.
      </SectionHeading>
      <PrReviewRunner />
    </PageShell>
  )
}
