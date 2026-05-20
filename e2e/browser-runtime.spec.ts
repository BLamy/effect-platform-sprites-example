import { expect, test } from "@playwright/test"

const serverSecret = "playwright-anthropic-secret"

test("runs browser-supported examples without server diagnostics or server runner", async ({
  page,
}) => {
  let diagnosticsCalls = 0
  let serverRunnerCalls = 0
  const outboundBodies: string[] = []
  const requestBodies: string[] = []

  await page.route("**/api/effect-language-service/diagnostics", route => {
    diagnosticsCalls += 1
    return route.fulfill({
      status: 500,
      body: "server diagnostics fallback should not be called",
    })
  })

  await page.route("**/api/examples/run**", route => {
    serverRunnerCalls += 1
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: "server example runner should not be called",
      }),
    })
  })

  await page.route("**/api/almostnode/outbound", route => {
    outboundBodies.push(route.request().postData() ?? "")
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: "blocked by test" }),
    })
  })

  page.on("request", request => {
    const body = request.postData()
    if (body) {
      requestBodies.push(body)
    }
  })

  await page.goto("/examples/command")
  await expect(page.getByText("Effect LS")).toBeVisible()
  await expect(page.getByText("Clear")).toBeVisible()

  const editor = page.getByRole("textbox", { name: "Scoped Command source" })
  await editor.click({ force: true })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
  await page.keyboard.insertText(`
await globalThis.proxiedFetch({
  service: "anthropic",
  path: "/not-allowed",
  method: "GET",
  headers: {
    authorization: "caller-authorization-header",
    cookie: "caller-cookie",
  },
})
`)

  await page.getByRole("button", { name: "Run edited" }).click()
  await expect(page.getByText("Completed")).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText("almostnode browser sandbox")).toBeVisible()

  expect(diagnosticsCalls).toBe(0)
  expect(serverRunnerCalls).toBe(0)
  expect(outboundBodies).toHaveLength(1)
  expect(requestBodies.join("\n")).not.toContain(serverSecret)
  await expect(page.locator("body")).not.toContainText(serverSecret)
})
