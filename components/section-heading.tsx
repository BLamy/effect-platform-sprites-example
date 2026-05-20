export function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="max-w-3xl space-y-2">
      <div className="text-xs font-medium tracking-[0.18em] text-emerald-700 uppercase dark:text-emerald-300">
        {eyebrow}
      </div>
      <h1 className="text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
        {title}
      </h1>
      {children ? (
        <p className="text-sm leading-6 text-muted-foreground md:text-base">
          {children}
        </p>
      ) : null}
    </div>
  )
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 md:px-6 md:py-10">
      {children}
    </div>
  )
}
