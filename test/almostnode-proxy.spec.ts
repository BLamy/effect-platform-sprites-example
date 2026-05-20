import { describe, expect, it, vi } from "vitest"

import {
  AlmostNodeProxyError,
  createAlmostNodeProxySession,
  executeAlmostNodeOutboundRequest,
  redactedProxyError,
  verifyAlmostNodeProxySession,
} from "../lib/almostnode-proxy"

const baseEnv = {
  ALMOSTNODE_PROXY_SESSION_SECRET: "test-secret",
  ANTHROPIC_API_KEY: "anthropic-secret",
  OPENAI_API_KEY: "openai-secret",
  REPLAY_MCP_TOKEN: "replay-secret",
} as unknown as NodeJS.ProcessEnv

function session(services?: readonly string[], ttlMs?: number) {
  return createAlmostNodeProxySession({
    services,
    ttlMs,
    env: baseEnv,
  }).token
}

describe("almostnode outbound proxy", () => {
  it("creates signed short-lived sessions", () => {
    const created = createAlmostNodeProxySession({ env: baseEnv })
    const payload = verifyAlmostNodeProxySession(created.token, baseEnv)

    expect(payload.services).toContain("anthropic")
    expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it("injects service secrets and strips caller credentials", async () => {
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers)

      expect(String(url)).toBe("https://api.anthropic.com/v1/messages")
      expect(init?.method).toBe("POST")
      expect(headers.get("x-api-key")).toBe("anthropic-secret")
      expect(headers.get("anthropic-version")).toBe("2023-06-01")
      expect(headers.get("authorization")).toBeNull()
      expect(headers.get("cookie")).toBeNull()
      expect(headers.get("content-type")).toBe("application/json")

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", server: "hidden" },
      })
    })

    const response = await executeAlmostNodeOutboundRequest({
      token: session(["anthropic"]),
      request: {
        service: "anthropic",
        path: "/v1/messages",
        headers: {
          authorization: "Bearer caller-token",
          cookie: "session=caller",
          "content-type": "application/json",
        },
        body: { model: "claude-opus-4-6" },
      },
      env: baseEnv,
      fetchImpl,
    })

    expect(response.status).toBe(200)
    expect(response.headers).toEqual({ "content-type": "application/json" })
  })

  it("rejects unknown services and disallowed paths", async () => {
    await expect(
      executeAlmostNodeOutboundRequest({
        token: session(),
        request: { service: "unknown", path: "/v1/messages" },
        env: baseEnv,
      })
    ).rejects.toMatchObject({ status: 400 })

    await expect(
      executeAlmostNodeOutboundRequest({
        token: session(["openai"]),
        request: { service: "openai", path: "/admin/secrets" },
        env: baseEnv,
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it("rejects expired sessions and unauthorized service scopes", async () => {
    await expect(
      executeAlmostNodeOutboundRequest({
        token: session(["anthropic"], -1),
        request: { service: "anthropic", path: "/v1/messages" },
        env: baseEnv,
      })
    ).rejects.toMatchObject({ status: 401 })

    await expect(
      executeAlmostNodeOutboundRequest({
        token: session(["anthropic"]),
        request: { service: "openai", path: "/v1/responses" },
        env: baseEnv,
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it("redacts unexpected fetch errors", () => {
    expect(redactedProxyError(new Error("contains secret"))).toEqual({
      status: 502,
      message: "Outbound proxy request failed",
    })
    expect(redactedProxyError(new AlmostNodeProxyError("bad path", 403))).toEqual({
      status: 403,
      message: "bad path",
    })
  })
})
