/**
 * Starts Effect DevTools when the Next.js Node server boots.
 * Set EFFECT_DEVTOOLS=true in .env.local (see lib/effect-devtools.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return
  }

  const { ensureDevTools } = await import("@/lib/effect-devtools")
  await ensureDevTools()
}
