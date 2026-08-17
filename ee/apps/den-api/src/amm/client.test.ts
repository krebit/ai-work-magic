import { createServer, type IncomingHttpHeaders } from "node:http"
import { afterEach, describe, expect, it } from "bun:test"
import {
  AmmClientError,
  AmmResearchClient,
  type AmmResearchClientConfig,
} from "./client.js"

type CapturedRequest = {
  body: unknown
  headers: IncomingHttpHeaders
  method: string | undefined
  url: string | undefined
}

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
  requests: CapturedRequest[]
}

const config: AmmResearchClientConfig = {
  baseUrl: "http://127.0.0.1:1",
  serviceKey: "service-test-key",
  timeoutMs: 100,
}

const collectionInput = {
  operationKey: "ammop_test",
  evaluationTargetAsOf: "2026-08-17T00:00:00.000Z",
  keyword: "fantasy romance",
  marketplace: "amazon.com",
  language: "en",
  department: "books" as const,
  targetFormat: "paperback" as const,
  currency: "USD",
  collectionIntent: "refresh" as const,
  evidenceLevel: "standard",
  limits: { maxUnits: 20, maxProducts: 3, maxPages: 1, searchDepth: 3 },
}

const runResponse = {
  runId: "run_test",
  operation: "kdp.keyword-collection",
  state: "queued",
  result: null,
  usage: { capabilityUnits: 1, providerCalls: 1, upstreamCostUsd: "0.01" },
  requestId: "amm_req_test",
}

const acknowledgementResponse = {
  runId: "run_test",
  operation: "kdp.keyword-collection",
  state: "queued",
  requestId: "amm_req_test",
}

const cancellationAcknowledgementResponse = {
  ...acknowledgementResponse,
  state: "cancelled",
}

const servers: TestServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

async function startServer(respond: (request: CapturedRequest) => {
  body?: unknown
  delayMs?: number
  status?: number
}): Promise<TestServer> {
  const requests: CapturedRequest[] = []
  const server = createServer(async (request, response) => {
    let text = ""
    for await (const chunk of request) text += String(chunk)
    const captured = {
      body: text ? JSON.parse(text) : undefined,
      headers: request.headers,
      method: request.method,
      url: request.url,
    }
    requests.push(captured)
    const result = respond(captured)
    setTimeout(() => {
      response.writeHead(result.status ?? 200, { "content-type": "application/json" })
      response.flushHeaders()
      response.end(JSON.stringify(result.body ?? runResponse))
    }, result.delayMs ?? 0)
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected the witness server to use a TCP address")

  const testServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    requests,
  }
  servers.push(testServer)
  return testServer
}

function clientFor(baseUrl: string, options: Partial<AmmResearchClientConfig> = {}) {
  return new AmmResearchClient({
    config: { ...config, ...options, baseUrl },
    fetchImpl: fetch,
  })
}

function expectAmmError(error: unknown, code: AmmClientError["code"], secret = config.serviceKey) {
  expect(error).toBeInstanceOf(AmmClientError)
  if (!(error instanceof AmmClientError)) throw new Error("Expected AmmClientError")
  expect(error.code).toBe(code)
  expect(error.message).not.toContain(secret)
  expect(error.toString()).not.toContain(secret)
  expect(JSON.stringify(error)).not.toContain(secret)
}

async function expectAmmRejection(promise: Promise<unknown>, code: AmmClientError["code"], secret?: string) {
  try {
    await promise
  } catch (error) {
    expectAmmError(error, code, secret)
    return
  }
  throw new Error(`Expected ${code} rejection`)
}

describe("AmmResearchClient", () => {
  it("accepts the live strict start and cancel acknowledgements without a result", async () => {
    const requests: string[] = []
    const client = new AmmResearchClient({
      config,
      fetchImpl: async (input, init) => {
        requests.push(`${init?.method} ${new URL(String(input)).pathname}`)
        return Response.json(init?.method === "DELETE" ? cancellationAcknowledgementResponse : acknowledgementResponse)
      },
    })

    const started = await client.startCollection(collectionInput, {
      idempotencyKey: "denop_globally_unique_test",
      requestId: "req_test",
    })
    const cancelled = await client.cancelRun("run_test", { requestId: "req_test" })

    expect(started).toEqual(acknowledgementResponse)
    expect(cancelled).toEqual(cancellationAcknowledgementResponse)
    expect(requests).toEqual([
      "POST /api/v1/kdp/keyword-collections",
      "DELETE /api/v1/runs/run_test",
    ])
  })

  it.each(["running", "succeeded"])("rejects a %s cancellation acknowledgement", async (state) => {
    const client = new AmmResearchClient({
      config,
      fetchImpl: () => Promise.resolve(Response.json({ ...acknowledgementResponse, state })),
    })

    await expectAmmRejection(
      client.cancelRun("run_test", { requestId: "req_test" }),
      "amm_invalid_response",
    )
  })

  it("sends only the service authorization and public collection body downstream", async () => {
    const server = await startServer(() => ({ body: acknowledgementResponse }))

    const result = await clientFor(server.baseUrl).startCollection(collectionInput, {
      idempotencyKey: "denop_globally_unique_test",
      requestId: "req_test",
    })

    expect(result).toEqual(acknowledgementResponse)
    expect(server.requests).toHaveLength(1)
    const [captured] = server.requests
    expect(captured.method).toBe("POST")
    expect(captured.url).toBe("/api/v1/kdp/keyword-collections")
    expect(captured.headers.authorization).toBe("Bearer service-test-key")
    expect(captured.headers["idempotency-key"]).toBe("denop_globally_unique_test")
    expect(captured.headers["x-request-id"]).toBe("req_test")
    expect(captured.headers["x-den-organization-id"]).toBeUndefined()
    expect(captured.headers["x-den-member-id"]).toBeUndefined()
    expect(captured.body).not.toHaveProperty("organizationId")
    expect(captured.body).toHaveProperty("queries.0.candidateId", "ammop_test")
  })

  it("uses the documented AMM paths for run, observations, and scoring calls", async () => {
    const server = await startServer((request) => ({
      body: request.url?.startsWith("/api/v1/kdp/keyword-observations")
        ? { observations: [] }
        : request.url === "/api/v1/kdp/keyword-scores"
          ? { scores: [] }
          : request.method === "DELETE"
            ? cancellationAcknowledgementResponse
            : runResponse,
    }))
    const client = clientFor(server.baseUrl)

    await client.getRun("run_test", { requestId: "req_test" })
    await client.cancelRun("run_test", { requestId: "req_test" })
    await client.getKeywordObservations({ keyword: "fantasy romance" }, { requestId: "req_test" })
    await client.scoreKeywords({
      schemaVersion: "amm.kdp.keyword-scores.request/v1",
      candidates: [{ candidateId: "candidate_test", demand: 80, competition: 20 }],
    }, { requestId: "req_test" })

    expect(server.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET /api/v1/runs/run_test",
      "DELETE /api/v1/runs/run_test",
      "GET /api/v1/kdp/keyword-observations?keyword=fantasy+romance&marketplace=amazon.com&freshWithinHours=24",
      "POST /api/v1/kdp/keyword-scores",
    ])
  })

  it("maps remote failures to stable errors without exposing the service key", async () => {
    for (const [status, code] of [
      [401, "amm_unauthorized"],
      [409, "amm_idempotency_conflict"],
      [429, "amm_rate_limited"],
      [503, "amm_upstream_error"],
    ] as const) {
      const server = await startServer(() => ({ status, body: { detail: `Bearer ${config.serviceKey}` } }))

      await expectAmmRejection(
        clientFor(server.baseUrl).startCollection(collectionInput, {
          idempotencyKey: "denop_globally_unique_test",
          requestId: "req_test",
        }),
        code,
      )
    }
  })

  it("maps a malformed successful response to a stable safe error", async () => {
    const server = await startServer(() => ({ body: { runId: "run_test" } }))

    await expectAmmRejection(
      clientFor(server.baseUrl).startCollection(collectionInput, {
        idempotencyKey: "denop_globally_unique_test",
        requestId: "req_test",
      }),
      "amm_invalid_response",
    )
  })

  it("maps an aborted AMM request to a stable safe timeout error", async () => {
    const server = await startServer(() => ({ body: runResponse, delayMs: 100 }))

    await expectAmmRejection(
      clientFor(server.baseUrl, { timeoutMs: 5 }).startCollection(collectionInput, {
        idempotencyKey: "denop_globally_unique_test",
        requestId: "req_test",
      }),
      "amm_timeout",
    )
  })

  it("maps a response body that stalls after headers to a safe timeout error", async () => {
    const client = new AmmResearchClient({
      config: { ...config, timeoutMs: 5 },
      fetchImpl: async (_input, init) => {
        const signal = init?.signal
        const body = new ReadableStream({
          start(controller) {
            signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true })
          },
        })
        return new Response(body, { headers: { "content-type": "application/json" } })
      },
    })

    await expectAmmRejection(
      client.startCollection(collectionInput, {
        idempotencyKey: "denop_globally_unique_test",
        requestId: "req_test",
      }),
      "amm_timeout",
    )
  })

  it("sanitizes malformed service credentials before a request can expose them", async () => {
    const malformedSecret = "service-test-key\ninvalid-header"
    const client = clientFor("http://127.0.0.1:1", { serviceKey: malformedSecret })

    await expectAmmRejection(
      client.startCollection(collectionInput, {
        idempotencyKey: "denop_globally_unique_test",
        requestId: "req_test",
      }),
      "amm_request_failed",
      malformedSecret,
    )
  })

  it("reports missing AMM configuration only when an AMM call is attempted", async () => {
    const client = new AmmResearchClient({ config: null, fetchImpl: fetch })

    await expectAmmRejection(client.startCollection(collectionInput, {
      idempotencyKey: "denop_globally_unique_test",
      requestId: "req_test",
    }), "amm_not_configured")
  })
})
