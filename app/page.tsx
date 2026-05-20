import Link from "next/link"
import {
  Activity,
  ArrowRight,
  Box,
  Braces,
  Code2,
  ExternalLink,
  FileText,
  GitBranch,
  GitPullRequest,
  Layers,
  Play,
  Radar,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { CodeViewer } from "@/components/code-viewer"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SectionHeading } from "@/components/section-heading"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  effectDevtoolsIntro,
  effectDevtoolsNextExample,
  effectDevtoolsNodeExample,
  effectDevtoolsNotes,
  effectDevtoolsSetup,
} from "@/lib/effect-devtools-content"
import {
  behaviorNotes,
  codeExamples,
  quickCommands,
  runtimeSteps,
  vscodeShellSetup,
} from "@/lib/sprite-doc-content"
import { packageSurface } from "@/lib/sprite-docs"

const serviceIcons: Record<
  (typeof packageSurface)[number]["name"],
  LucideIcon
> = {
  SpriteContext: Layers,
  SpriteCommandExecutor: Terminal,
  SpriteFileSystem: FileText,
  SpriteSession: GitBranch,
  SpriteTerminal: Box,
  SpriteRuntime: Play,
  SpriteClient: Braces,
  sh: Code2,
}

export default function Page() {
  return (
    <>
      <section className="border-b bg-[linear-gradient(180deg,rgba(16,185,129,0.08),rgba(255,255,255,0)_72%)] dark:bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(0,0,0,0)_72%)]">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 md:px-6 md:py-12">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-md">
              shadcn Next.js example
            </Badge>
            <Badge
              variant="outline"
              className="rounded-md border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300"
            >
              imports local package
            </Badge>
          </div>

          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-normal md:text-4xl lg:text-5xl">
              Sprite-native Effect platform docs and examples
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
              How Replay code runs Effect programs against Sprites: use platform
              abstractions for scoped commands and files, and reach for explicit
              Sprite sessions when sandbox work must detach.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/examples/${codeExamples[0].value}`}
              className={cn(buttonVariants({ variant: "default" }), "gap-2")}
            >
              <Code2 className="size-4" aria-hidden />
              View examples
            </Link>
            <a
              href="https://github.com/replayio/replay-endpoints/tree/main/packages/effect-platform-sprites"
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
            >
              <ExternalLink className="size-4" aria-hidden />
              Package source
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl space-y-12 px-4 py-8 md:space-y-16 md:px-6 md:py-12">
        <section id="examples" className="scroll-mt-20 space-y-5">
          <SectionHeading
            eyebrow="Examples"
            title="One Effect program per page"
          >
            Each example runs against a Sprite and has its own page. Open one to
            read the source and run it.
          </SectionHeading>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ...codeExamples.map((example) => ({
                href: `/examples/${example.value}`,
                title: example.title,
                description: example.description,
                icon: Play,
              })),
              {
                href: "/examples/agent-print",
                title: "One-shot agent",
                description:
                  "Send a single prompt to Codex, Claude Code, OpenCode, Gemini CLI, or Pi running inside a remote Sprite.",
                icon: Sparkles,
              },
              {
                href: "/examples/agent-interactive",
                title: "Interactive agent",
                description:
                  "Start Codex, Claude Code, OpenCode, Gemini CLI, or Pi in a remote Sprite TTY and drive it from the browser.",
                icon: Terminal,
              },
              {
                href: "/examples/pr-comment-bot",
                title: "PR comment bot",
                description:
                  "Trigger the local Replay PR comment bot flow and inspect the Effect trace.",
                icon: GitPullRequest,
              },
            ].map((example) => (
              <Link
                key={example.href}
                href={example.href}
                className="group rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Card className="h-full transition hover:border-emerald-200 hover:shadow-sm dark:hover:border-emerald-900">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <example.icon
                        className="size-4 text-emerald-700 dark:text-emerald-300"
                        aria-hidden
                      />
                      {example.title}
                    </CardTitle>
                    <CardDescription>{example.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      Open
                      <ArrowRight
                        className="size-3.5 transition group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        <section id="surface" className="scroll-mt-20 space-y-5">
          <SectionHeading
            eyebrow="Package surface"
            title="Every card imports the real package"
          >
            The docs app depends on{" "}
            <code>@replayio/effect-platform-sprites</code> through a local file
            dependency, so typecheck and build catch stale examples.
          </SectionHeading>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {packageSurface.map((service) => {
              const Icon = serviceIcons[service.name]
              return (
                <Card key={service.name} className="rounded-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon
                        className="size-4 text-emerald-700 dark:text-emerald-300"
                        aria-hidden
                      />
                      {service.name}
                    </CardTitle>
                    <CardDescription>{service.symbol}</CardDescription>
                    <CardAction>
                      <Badge
                        variant={
                          service.status === "wired"
                            ? "secondary"
                            : "destructive"
                        }
                        className="rounded-md"
                      >
                        {service.status}
                      </Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {service.summary}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>

        <section id="devtools" className="scroll-mt-20 space-y-5">
          <SectionHeading
            eyebrow="Observability"
            title={effectDevtoolsIntro.title}
          >
            {effectDevtoolsIntro.description}
          </SectionHeading>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Radar
                className="size-4 text-emerald-700 dark:text-emerald-300"
                aria-hidden
              />
              Setup
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This app uses Effect&apos;s tracer hooks around each runnable
              example. For the external DevTools backend, install{" "}
              <code className="rounded border bg-background px-1 py-0.5 text-[0.8rem]">
                @effect/experimental
              </code>
              , import <code>DevTools</code>, and provide{" "}
              <code>DevTools.layer()</code> before running your Effect program.
              The layer expects the DevTools backend at{" "}
              <code>{effectDevtoolsSetup.defaultServer}</code> unless you pass a
              custom websocket URL.
            </p>
            <Separator className="my-4" />
            <code className="block overflow-x-auto rounded-md border bg-background px-3 py-2 text-[0.8rem] text-muted-foreground">
              {effectDevtoolsSetup.installCommand}
            </code>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Node entrypoint</div>
              <CodeViewer
                value={effectDevtoolsNodeExample}
                maxHeight={448}
                ariaLabel="Effect DevTools Node entrypoint source"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Next.js + SpriteContext</div>
              <CodeViewer
                value={effectDevtoolsNextExample}
                maxHeight={448}
                ariaLabel="Effect DevTools Next.js source"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {effectDevtoolsNotes.map((note) => (
              <div key={note.title} className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Radar
                    className="size-4 text-emerald-700 dark:text-emerald-300"
                    aria-hidden
                  />
                  {note.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {note.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="model" className="scroll-mt-20 space-y-5">
          <SectionHeading
            eyebrow="Runtime model"
            title="Host control, remote execution"
          >
            The host process controls leases, retries, spans, and job state. The
            Sprite platform layer only changes where command, filesystem, and
            terminal effects run.
          </SectionHeading>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {runtimeSteps.map((step, index) => (
              <div key={step.label} className="rounded-lg border bg-card p-4">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-200">
                    {index === 0 ? (
                      <Server className="size-4" aria-hidden />
                    ) : index === 1 ? (
                      <Layers className="size-4" aria-hidden />
                    ) : index === 2 ? (
                      <Activity className="size-4" aria-hidden />
                    ) : (
                      <Terminal className="size-4" aria-hidden />
                    )}
                  </span>
                  <Badge variant="outline" className="rounded-md">
                    {index + 1}
                  </Badge>
                </div>
                <div className="text-sm font-medium">{step.label}</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="behavior" className="scroll-mt-20 space-y-5">
          <SectionHeading
            eyebrow="Behavior"
            title="The part future changes should preserve"
          >
            The docs encode the operational assumptions behind the package so
            app changes do not blur scoped process cleanup, detached sessions,
            and Sprite lifecycle ownership.
          </SectionHeading>

          <div className="grid gap-3 sm:grid-cols-2">
            {behaviorNotes.map((note) => (
              <div key={note.title} className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck
                    className="size-4 text-emerald-700 dark:text-emerald-300"
                    aria-hidden
                  />
                  {note.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {note.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="local" className="scroll-mt-20 space-y-5">
          <SectionHeading
            eyebrow="Local run"
            title="Use the root scripts or the example directly"
          >
            The example was created with{" "}
            <code>npx shadcn@latest create --template next</code> and keeps its
            own lockfile. Root scripts are convenience wrappers.
          </SectionHeading>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Play
                className="size-4 text-emerald-700 dark:text-emerald-300"
                aria-hidden
              />
              Commands
            </div>
            <Separator className="my-4" />
            <div className="grid gap-2">
              {quickCommands.map((command) => (
                <code
                  key={command}
                  className="overflow-x-auto rounded-md border bg-background px-3 py-2 text-[0.8rem] text-muted-foreground"
                >
                  {command}
                </code>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Code2
                className="size-4 text-emerald-700 dark:text-emerald-300"
                aria-hidden
              />
              VS Code shell templates
            </div>
            <Separator className="my-4" />
            <div className="grid gap-3 lg:grid-cols-3">
              {vscodeShellSetup.map((item) => (
                <div key={item.title} className="space-y-2">
                  <div className="text-sm font-medium">{item.title}</div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {item.body}
                  </p>
                  <pre className="overflow-x-auto rounded-md border bg-background p-3 text-[0.78rem] leading-relaxed text-muted-foreground">
                    <code>{item.command}</code>
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
