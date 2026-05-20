import { defineConfig, devices } from "@playwright/test"

const appPort = Number(process.env.PLAYWRIGHT_APP_PORT ?? 3100)
const sandboxPort = Number(process.env.PLAYWRIGHT_SANDBOX_PORT ?? 3102)
const sandboxOrigin = `http://127.0.0.1:${sandboxPort}`

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: {
    timeout: 60_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `npm run prepare:almostnode && npx vite public/almostnode-sandbox --host 127.0.0.1 --port ${sandboxPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      url: sandboxOrigin,
    },
    {
      command: `ALMOSTNODE_SANDBOX_ORIGIN=${sandboxOrigin} ALMOSTNODE_PROXY_SESSION_SECRET=playwright-session-secret ANTHROPIC_API_KEY=playwright-anthropic-secret npm run start -- --port ${appPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      url: `http://127.0.0.1:${appPort}`,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
