export const effectDevtoolsIntro = {
  title: "In-app Effect trace viewer",
  description:
    "Run an example and inspect its Effect spans, attributes, events, and errors directly in this app.",
} as const

export const effectDevtoolsSetup = {
  installCommand: "npm install @effect/experimental",
  defaultServer: "ws://localhost:34437",
} as const

export const effectDevtoolsNodeExample = `import { DevTools } from "@effect/experimental"
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

const program = Effect.log("Hello!").pipe(
  Effect.delay(2000),
  Effect.withSpan("Hi", { attributes: { foo: "bar" } }),
  Effect.forever,
)

const DevToolsLive = DevTools.layer()

program.pipe(Effect.provide(DevToolsLive), NodeRuntime.runMain)`

export const effectDevtoolsNextExample = `// instrumentation.ts (server boot)
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return
  const { ensureDevTools } = await import("@/lib/effect-devtools")
  await ensureDevTools()
}

// app/api/examples/run/route.ts
import { runServerEffect } from "@/lib/effect-devtools"

export async function POST(request: Request) {
  const program = myEffectHandler(request).pipe(
    Effect.withSpan("parse-request-body")
  )
  return runServerEffect("POST /api/examples/run", program)
}`

export const effectDevtoolsNotes = [
  {
    title: "Local trace capture",
    body: "The example route installs a per-run tracer before executing Sprite examples, so each run returns a trace tree without requiring the VS Code DevTools backend.",
  },
  {
    title: "OpenTelemetry layer order",
    body: "If you use @effect/opentelemetry, provide the DevTools layer before tracing layers so the tracer is patched correctly.",
  },
  {
    title: "Host-side boundary",
    body: "The viewer traces the host Effect program and Sprite API calls. Remote shell commands appear as Sprite spans unless the remote process also runs Effect and connects to a collector.",
  },
  {
    title: "External DevTools optional",
    body: "EFFECT_DEVTOOLS=true still connects to the standard Effect DevTools websocket. The in-app trace viewer does not require that flag.",
  },
] as const
