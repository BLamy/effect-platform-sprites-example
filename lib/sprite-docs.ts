import {
  SpriteClient,
  SpriteCommandExecutor,
  SpriteContext,
  SpriteFileSystem,
  SpriteRuntime,
  SpriteSession,
  SpriteTerminal,
  sh,
} from "@replayio/effect-platform-sprites"

export const packageSurface = [
  {
    name: "SpriteContext",
    symbol: "new SpriteContext(spriteId?, checkpointId?)",
    status: typeof SpriteContext.layer === "function" ? "wired" : "missing",
    summary:
      "Resolves or creates a Sprite, passes creation config such as url_settings.auth, optionally restores a checkpoint, then provides the platform services.",
  },
  {
    name: "SpriteCommandExecutor",
    symbol: "Command.start / Command.string",
    status:
      typeof SpriteCommandExecutor.layer === "function" ? "wired" : "missing",
    summary:
      "Runs Effect Command programs through Sprite exec sessions with scoped interruption and exit code handling.",
  },
  {
    name: "SpriteFileSystem",
    symbol: "FileSystem.FileSystem",
    status: typeof SpriteFileSystem.layer === "function" ? "wired" : "missing",
    summary:
      "Uses Sprite filesystem endpoints first and POSIX command fallbacks where the remote API has no direct operation.",
  },
  {
    name: "SpriteSession",
    symbol: "SpriteSession.startDetached(command)",
    status:
      typeof SpriteSession.startDetached === "function" ? "wired" : "missing",
    summary:
      "Starts explicit detached sessions for long-running sandbox jobs that should survive Effect scope release.",
  },
  {
    name: "SpriteTerminal",
    symbol: "SpriteTerminal.create({ tty })",
    status: typeof SpriteTerminal.create === "function" ? "wired" : "missing",
    summary:
      "Creates remote TTY sessions and exposes the sound subset of Effect Terminal semantics for Sprites.",
  },
  {
    name: "SpriteRuntime",
    symbol: "SpriteRuntime.runPromise(sprite, effect)",
    status:
      typeof SpriteRuntime.runPromise === "function" ? "wired" : "missing",
    summary:
      "Small run boundary helpers that accept either a raw Sprite or a SpriteContext before executing an Effect program.",
  },
  {
    name: "SpriteClient",
    symbol: "SpriteClient.request({ path })",
    status: typeof SpriteClient.request === "function" ? "wired" : "missing",
    summary:
      "Lower-level typed request service for Sprite HTTP APIs used by platform adapters and advanced examples.",
  },
  {
    name: "sh",
    symbol: "sh`set -euo pipefail`",
    status: typeof sh === "function" ? "wired" : "missing",
    summary:
      "Tagged-template shorthand for Command.make(\"/bin/sh\", \"-lc\", script) with normal TypeScript interpolation.",
  },
] as const
