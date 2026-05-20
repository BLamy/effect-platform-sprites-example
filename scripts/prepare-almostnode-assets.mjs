import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { generateSandboxFiles } from "almostnode"
import { build } from "esbuild"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const almostnodeDist = join(root, "node_modules", "almostnode", "dist")
const publicRoot = join(root, "public")
const sandboxRoot = join(publicRoot, "almostnode-sandbox")

await rm(join(publicRoot, "almostnode"), { force: true, recursive: true })
await rm(sandboxRoot, { force: true, recursive: true })

await mkdir(join(publicRoot, "almostnode"), { recursive: true })
await mkdir(join(publicRoot, "assets"), { recursive: true })
await mkdir(join(sandboxRoot, "almostnode"), { recursive: true })
await mkdir(join(sandboxRoot, "assets"), { recursive: true })

const zlibShimPlugin = {
  name: "browser-zlib-shim",
  setup(bundle) {
    bundle.onResolve({ filter: /^node:zlib$/ }, () => ({
      namespace: "almostnode-shims",
      path: "node:zlib",
    }))
    bundle.onLoad({ filter: /^node:zlib$/, namespace: "almostnode-shims" }, () => ({
      contents: `
export const constants = {}
export function gunzipSync() {
  throw new Error("node:zlib is unavailable in the browser almostnode runtime")
}
export function gzipSync() {
  throw new Error("node:zlib is unavailable in the browser almostnode runtime")
}
`,
      loader: "js",
    }))
  },
}

await build({
  bundle: true,
  entryPoints: [join(almostnodeDist, "index.mjs")],
  format: "esm",
  logLevel: "silent",
  outfile: join(publicRoot, "almostnode", "index.mjs"),
  platform: "browser",
  plugins: [zlibShimPlugin],
})
await copyFile(
  join(publicRoot, "almostnode", "index.mjs"),
  join(sandboxRoot, "almostnode", "index.mjs")
)

for (const file of await readdir(join(almostnodeDist, "assets"))) {
  if (file.startsWith("runtime-worker-") && file.endsWith(".js")) {
    await copyFile(
      join(almostnodeDist, "assets", file),
      join(publicRoot, "assets", file)
    )
    await copyFile(
      join(almostnodeDist, "assets", file),
      join(sandboxRoot, "assets", file)
    )
  }
}

const sandboxFiles = generateSandboxFiles({
  almostnodeUrl: "/almostnode/index.mjs",
})

for (const [file, contents] of Object.entries(sandboxFiles)) {
  await writeFile(join(sandboxRoot, file), contents)
}

// Importing almostnode keeps runtime handles open in Node; this script is only
// an asset generator, so exit once the public files are written.
process.exit(0)
