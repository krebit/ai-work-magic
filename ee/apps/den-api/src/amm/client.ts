import {
  ammKeywordObservationQuerySchema,
  ammOperationParamsSchema,
  ammRunResponseSchema,
  scoreAmmKdpKeywordsSchema,
  startAmmKdpKeywordCollectionSchema,
  toAmmCollectionBody,
  type StartAmmKdpKeywordCollection,
} from "./contracts.js"

const DEFAULT_AMM_REQUEST_TIMEOUT_MS = 10_000

export type AmmResearchClientConfig = {
  baseUrl: string
  serviceKey: string
  timeoutMs: number
}

export type AmmRequestContext = {
  requestId: string
}

export type AmmClientErrorCode =
  | "amm_not_configured"
  | "amm_unauthorized"
  | "amm_idempotency_conflict"
  | "amm_rate_limited"
  | "amm_timeout"
  | "amm_invalid_response"
  | "amm_upstream_error"
  | "amm_request_failed"

export class AmmClientError extends Error {
  readonly code: AmmClientErrorCode
  readonly status: number | undefined

  constructor(code: AmmClientErrorCode, status?: number) {
    super(code)
    this.name = "AmmClientError"
    this.code = code
    this.status = status
  }
}

type AmmResearchClientOptions = {
  config: AmmResearchClientConfig | null
  fetchImpl?: typeof fetch
}

function isTimeout(error: unknown) {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
}

function errorForStatus(status: number): AmmClientError {
  if (status === 401 || status === 403) return new AmmClientError("amm_unauthorized", status)
  if (status === 409) return new AmmClientError("amm_idempotency_conflict", status)
  if (status === 429) return new AmmClientError("amm_rate_limited", status)
  if (status >= 500) return new AmmClientError("amm_upstream_error", status)
  return new AmmClientError("amm_request_failed", status)
}

function requestTimeout(timeoutMs: number) {
  return Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_AMM_REQUEST_TIMEOUT_MS
}

function parseRunResponse(response: unknown) {
  const parsed = ammRunResponseSchema.safeParse(response)
  if (!parsed.success) throw new AmmClientError("amm_invalid_response")
  return parsed.data
}

export class AmmResearchClient {
  private readonly config: AmmResearchClientConfig | null
  private readonly fetchImpl: typeof fetch

  constructor(options: AmmResearchClientOptions) {
    this.config = options.config
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async startCollection(input: StartAmmKdpKeywordCollection, context: AmmRequestContext) {
    const collection = startAmmKdpKeywordCollectionSchema.parse(input)
    const response = await this.request("/api/v1/kdp/keyword-collections", {
      body: toAmmCollectionBody(collection),
      idempotencyKey: collection.operationKey,
      method: "POST",
      requestId: context.requestId,
    })
    return parseRunResponse(response)
  }

  async getRun(runId: string, context: AmmRequestContext) {
    const operation = ammOperationParamsSchema.parse({ operationId: runId })
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(operation.operationId)}`, {
      method: "GET",
      requestId: context.requestId,
    })
    return parseRunResponse(response)
  }

  async cancelRun(runId: string, context: AmmRequestContext) {
    const operation = ammOperationParamsSchema.parse({ operationId: runId })
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(operation.operationId)}`, {
      method: "DELETE",
      requestId: context.requestId,
    })
    return parseRunResponse(response)
  }

  async getKeywordObservations(input: unknown, context: AmmRequestContext): Promise<unknown> {
    const query = ammKeywordObservationQuerySchema.parse(input)
    const parameters = new URLSearchParams({
      keyword: query.keyword,
      marketplace: query.marketplace,
      freshWithinHours: String(query.freshWithinHours),
    })
    if (query.department) parameters.set("department", query.department)
    if (query.format) parameters.set("format", query.format)
    return this.request(`/api/v1/kdp/keyword-observations?${parameters.toString()}`, {
      method: "GET",
      requestId: context.requestId,
    })
  }

  async scoreKeywords(input: unknown, context: AmmRequestContext): Promise<unknown> {
    const scores = scoreAmmKdpKeywordsSchema.parse(input)
    return this.request("/api/v1/kdp/keyword-scores", {
      body: scores,
      method: "POST",
      requestId: context.requestId,
    })
  }

  private async request(path: string, input: {
    body?: unknown
    idempotencyKey?: string
    method: "DELETE" | "GET" | "POST"
    requestId: string
  }): Promise<unknown> {
    if (!this.config) throw new AmmClientError("amm_not_configured")

    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${this.config.serviceKey}`,
      "x-request-id": input.requestId,
    })
    if (input.idempotencyKey) headers.set("idempotency-key", input.idempotencyKey)
    if (input.body !== undefined) headers.set("content-type", "application/json")

    let response: Response
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, "")}${path}`, {
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        headers,
        method: input.method,
        signal: AbortSignal.timeout(requestTimeout(this.config.timeoutMs)),
      })
    } catch (error) {
      if (isTimeout(error)) throw new AmmClientError("amm_timeout")
      throw new AmmClientError("amm_request_failed")
    }

    if (!response.ok) throw errorForStatus(response.status)

    try {
      return await response.json()
    } catch {
      throw new AmmClientError("amm_invalid_response", response.status)
    }
  }
}
