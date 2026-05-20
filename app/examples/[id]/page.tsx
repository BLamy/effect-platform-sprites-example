import { notFound } from "next/navigation"

import { PageShell, SectionHeading } from "@/components/section-heading"
import { SingleExampleRunner } from "@/components/single-example"
import { codeExamples } from "@/lib/sprite-doc-content"

export function generateStaticParams() {
  return codeExamples.map((example) => ({ id: example.value }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const example = codeExamples.find((item) => item.value === id)
  return {
    title: example
      ? `${example.title} · Effect Platform Sprites`
      : "Example · Effect Platform Sprites",
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const example = codeExamples.find((item) => item.value === id)
  if (!example) notFound()

  return (
    <PageShell>
      <SectionHeading eyebrow="Example" title={example.title}>
        {example.description}
      </SectionHeading>
      <SingleExampleRunner example={example} />
    </PageShell>
  )
}
