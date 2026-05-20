# Effect Platform Sprites Next.js Example

This is a shadcn-created Next.js app that doubles as examples and docs for
`@replayio/effect-platform-sprites`.

It imports the package from the pkg.pr.new preview build:

```json
"@replayio/effect-platform-sprites": "https://pkg.pr.new/BLamy/effect-platform-sprites/@replayio/effect-platform-sprites@ea4fdc4"
```

That means `typecheck` and `build` verify the docs against the public package
artifact instead of a private monorepo-local file dependency.

## Commands

```bash
npm install
cp .env.example .env.local
npm run dev -- --port 3001
npm run typecheck
npm run build
```

The `predev` and `prebuild` scripts prepare the browser-hosted almostnode
runtime assets before Next.js starts or builds.

## Scope

The app documents:

- `new SpriteContext(spriteId?, checkpointId?, options?)`
- `SpriteContext.layer(sprite, options)` for already-resolved Sprite objects
- `SpriteCommandExecutor` through Effect `Command`
- `SpriteFileSystem` through Effect `FileSystem`
- `SpriteSession.startDetached`
- `SpriteTerminal.create`
- `SpriteRuntime.runPromise` and `runFork`

The static docs stay focused on how application code should provide the Sprite
Effect platform once a Sprite instance already exists. The optional run buttons
exercise those examples through the server-only API route described below.

## Executable Examples

The example page includes run buttons for each code sample. Browser-supported
examples run in-page through almostnode. Sprite-backed examples still call the
server-only `POST /api/examples/run` route, which reads `SPRITES_TOKEN` from the
Next.js process environment. The token is never sent to the browser.

Set these values in `.env.local`:

```bash
SPRITES_TOKEN=...
SPRITES_EXAMPLE_SPRITE_NAME=effect-platform-sprites-example-local
SPRITES_EXAMPLE_URL_AUTH=sprite
```

The route creates or reuses `SPRITES_EXAMPLE_SPRITE_NAME`, executes the selected
Effect program against that Sprite, and returns stdout plus run metadata to the
page. `SPRITES_EXAMPLE_URL_AUTH` maps to the Sprite creation config
`url_settings.auth` and can be `sprite` or `public`. Existing Sprites are reused
as-is; changing URL auth for an existing Sprite requires creating a new Sprite or
using an explicit Sprite update API.

The `shadcn Preview` example intentionally uses a separate Sprite name with a
`-preview` suffix and `url_settings.auth: "public"`. It runs
`npx shadcn@latest create --template next` through the package `sh` tagged
template helper, installs dependencies, starts Next.js on `0.0.0.0:8080`, waits
for the Sprite URL to respond, and renders the public Sprite URL in an iframe.

## VS Code Shell Templates

The root workspace recommends:

- `mike-north.vscode-tagged-templates` for `sh`/`bash` tagged-template syntax
  highlighting.
- `timonwong.shellcheck` for shell-file linting.
- `lionas.shellcheckselection` for linting selected inline template text.

Install ShellCheck on the host:

```bash
brew install shellcheck
```

For inline templates, select only the shell body inside `sh\`...\``and run`ShellCheckSelection: Run ShellCheck on Selection`. For fully automatic
ShellCheck diagnostics, keep long scripts in `.sh` files.

## Effect Trace Viewer

The example page includes an in-app Effect trace viewer inspired by the Effect
Playground trace view. Run any example and open the Trace tab to inspect spans,
attributes, events, durations, and error paths for that run.

The viewer captures host-side Effect spans in the Next.js process. Sprite API
calls, command launches, file operations, detached sessions, terminal creation,
and preview readiness checks appear in the tree. Remote shell commands are not
separate Effect runtimes unless the remote process itself runs Effect and sends
trace data back to a collector.

The external [Effect Dev Tools](https://effect.website/docs/guides/observability/devtools)
flow is still available for comparison:

- `instrumentation.ts` calls `ensureDevTools()` when the Next.js Node server
  starts, keeping the websocket and patched tracer alive for the process.
- `app/api/examples/run/route.ts` uses `runServerEffect()` so each request
  can be traced locally and optionally sent to Dev Tools.

Add to `.env.local` and restart `npm run dev`:

```bash
EFFECT_DEVTOOLS=true
# EFFECT_DEVTOOLS_URL=ws://localhost:34437
```

Open the Effect Dev Tools VS Code extension, then use the example run buttons on
the docs page.
