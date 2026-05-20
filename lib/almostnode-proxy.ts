import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export interface AlmostNodeProxySession {
  readonly token: string
  readonly expiresAt: string
  readonly services: readonly string[]
}

export interface AlmostNodeOutboundRequest {
  readonly service: string
  readonly path: string
  readonly method?: string
  readonly headers?: Record<string, string>
  readonly body?: unknown
}

export interface AlmostNodeOutboundResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: ReadableStream<Uint8Array> | null
}

interface ProxyTokenPayload {
  readonly version: 1
  readonly expiresAt: number
  readonly services: readonly string[]
  readonly nonce: string
}

interface ServicePolicy {
  readonly origin: string
  readonly methods: readonly string[]
  readonly path: RegExp
  readonly inject: (env: NodeJS.ProcessEnv) => Record<string, string>
}

export class AlmostNodeProxyError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "AlmostNodeProxyError"
  }
}

const defaultTtlMs = 15 * 60 * 1000
const unsafeForwardedHeaders = new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authorization",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
])

const allowedForwardedHeaders = new Set([
  "accept",
  "anthropic-beta",
  "content-type",
  "openai-beta",
  "x-replay-channel",
  "x-replay-target",
])

const responseHeaders = new Set([
  "cache-control",
  "content-encoding",
  "content-type",
  "retry-after",
])

const servicePolicies = {
  anthropic: {
    origin: "https://api.anthropic.com",
    methods: ["POST"],
    path: /^\/v1\/messages$/,
    inject: env => ({
      "anthropic-version": "2023-06-01",
      "x-api-key": requiredEnv(env, "ANTHROPIC_API_KEY"),
    }),
  },
  openai: {
    origin: "https://api.openai.com",
    methods: ["GET", "POST"],
    path: /^\/v1\/(?:responses|chat\/completions|models)(?:\/.*)?$/,
    inject: env => ({
      authorization: `Bearer ${requiredEnv(env, "OPENAI_API_KEY")}`,
    }),
  },
  replayMcp: {
    origin: process.env.REPLAY_MCP_PROXY_ORIGIN ?? "https://dispatch.replay.io",
    methods: ["GET", "POST"],
    path: /^\/mcp(?:\/.*)?$/,
    inject: env => ({
      authorization: `Bearer ${requiredEnv(env, "REPLAY_MCP_TOKEN")}`,
      "x-replay-channel": "almostnode-docs",
    }),
  },
} satisfies Record<string, ServicePolicy>

let localSessionSecret: string | undefined

function requiredEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim()
  if (!value) {
    throw new AlmostNodeProxyError(`${name} is not configured`, 503)
  }
  return value
}

function sessionSecret(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.ALMOSTNODE_PROXY_SESSION_SECRET?.trim()
  if (configured) {
    return configured
  }

  if (env.NODE_ENV === "production") {
    throw new AlmostNodeProxyError(
      "ALMOSTNODE_PROXY_SESSION_SECRET is required in production",
      503
    )
  }

  localSessionSecret ??= randomBytes(32).toString("base64url")
  return localSessionSecret
}

function encodePart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function sign(unsigned: string, secret: string) {
  return createHmac("sha256", secret).update(unsigned).digest("base64url")
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function parseToken(token: string, env?: NodeJS.ProcessEnv): ProxyTokenPayload {
  const [payloadPart, signature] = token.split(".")
  if (!payloadPart || !signature) {
    throw new AlmostNodeProxyError("Invalid proxy session token", 401)
  }

  const expected = sign(payloadPart, sessionSecret(env))
  if (!safeEqual(signature, expected)) {
    throw new AlmostNodeProxyError("Invalid proxy session token", 401)
  }

  let payload: ProxyTokenPayload
  try {
    payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8")
    ) as ProxyTokenPayload
  } catch {
    throw new AlmostNodeProxyError("Invalid proxy session token", 401)
  }

  if (
    payload.version !== 1 ||
    !Number.isFinite(payload.expiresAt) ||
    !Array.isArray(payload.services)
  ) {
    throw new AlmostNodeProxyError("Invalid proxy session token", 401)
  }

  if (payload.expiresAt <= Date.now()) {
    throw new AlmostNodeProxyError("Proxy session expired", 401)
  }

  return payload
}

function assertKnownService(service: string): keyof typeof servicePolicies {
  if (service in servicePolicies) {
    return service as keyof typeof servicePolicies
  }
  throw new AlmostNodeProxyError("Unknown outbound service", 400)
}

function cleanHeaders(headers: Record<string, string> | undefined) {
  const cleaned = new Headers()
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase()
    if (
      unsafeForwardedHeaders.has(normalized) ||
      !allowedForwardedHeaders.has(normalized)
    ) {
      continue
    }
    cleaned.set(name, value)
  }
  return cleaned
}

function cleanResponseHeaders(headers: Headers) {
  const cleaned = new Headers()
  for (const [name, value] of headers.entries()) {
    if (responseHeaders.has(name.toLowerCase())) {
      cleaned.set(name, value)
    }
  }
  return cleaned
}

function buildBody(method: string, body: unknown) {
  if (method === "GET" || method === "HEAD" || body === undefined) {
    return undefined
  }
  return typeof body === "string" || body instanceof Uint8Array
    ? body
    : JSON.stringify(body)
}

export function availableAlmostNodeProxyServices() {
  return Object.keys(servicePolicies)
}

export function createAlmostNodeProxySession(input: {
  readonly services?: readonly string[]
  readonly ttlMs?: number
  readonly env?: NodeJS.ProcessEnv
} = {}): AlmostNodeProxySession {
  const services = input.services ?? availableAlmostNodeProxyServices()
  for (const service of services) {
    assertKnownService(service)
  }

  const expiresAtMs = Date.now() + (input.ttlMs ?? defaultTtlMs)
  const payload: ProxyTokenPayload = {
    version: 1,
    expiresAt: expiresAtMs,
    services,
    nonce: randomBytes(12).toString("base64url"),
  }
  const payloadPart = encodePart(payload)
  return {
    token: `${payloadPart}.${sign(payloadPart, sessionSecret(input.env))}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
    services,
  }
}

export function verifyAlmostNodeProxySession(
  token: string,
  env?: NodeJS.ProcessEnv
) {
  return parseToken(token, env)
}

export async function executeAlmostNodeOutboundRequest(input: {
  readonly token: string
  readonly request: AlmostNodeOutboundRequest
  readonly env?: NodeJS.ProcessEnv
  readonly fetchImpl?: typeof fetch
}): Promise<AlmostNodeOutboundResponse> {
  const payload = parseToken(input.token, input.env)
  const service = assertKnownService(input.request.service)
  if (!payload.services.includes(service)) {
    throw new AlmostNodeProxyError("Proxy session cannot use this service", 403)
  }

  const policy = servicePolicies[service]
  const method = (input.request.method ?? "POST").toUpperCase()
  if (!policy.methods.includes(method)) {
    throw new AlmostNodeProxyError("Outbound method is not allowed", 405)
  }

  if (
    typeof input.request.path !== "string" ||
    !input.request.path.startsWith("/") ||
    input.request.path.startsWith("//") ||
    !policy.path.test(input.request.path.split("?")[0] ?? "")
  ) {
    throw new AlmostNodeProxyError("Outbound path is not allowed", 403)
  }

  const headers = cleanHeaders(input.request.headers)
  for (const [name, value] of Object.entries(policy.inject(input.env ?? process.env))) {
    headers.set(name, value)
  }
  if (!headers.has("content-type") && input.request.body !== undefined) {
    headers.set("content-type", "application/json")
  }

  const response = await (input.fetchImpl ?? fetch)(
    new URL(input.request.path, policy.origin),
    {
      method,
      headers,
      body: buildBody(method, input.request.body) as BodyInit | undefined,
      redirect: "manual",
    }
  )

  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(cleanResponseHeaders(response.headers)),
    body: response.body,
  }
}

export function redactedProxyError(error: unknown) {
  if (error instanceof AlmostNodeProxyError) {
    return { status: error.status, message: error.message }
  }
  return { status: 502, message: "Outbound proxy request failed" }
}
