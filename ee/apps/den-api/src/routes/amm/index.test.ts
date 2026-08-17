import { createDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { describe, expect, it } from "bun:test"
import { Hono } from "hono"
import type { RequestIdVariables } from "hono/request-id"
import { openAPIRouteHandler } from "hono-openapi"
import { z } from "zod"
import {
  ammRunAcknowledgementSchema,
  ammRunCancellationAcknowledgementSchema,
  ammRunResponseSchema,
  type AmmProviderUsage,
  type StartAmmKdpKeywordCollection,
} from "../../amm/contracts.js"
import { AmmClientError } from "../../amm/client.js"
import type {
  AmmOperation,
  AmmOperationUpdate,
  AmmStore,
  AmmStoreTransaction,
  AmmUsageBucket,
  AmmUsageBucketUpdate,
  AmmUsageLedgerEntry,
} from "../../amm/service.js"
import type { OrganizationContext } from "../../orgs.js"
import type { CapabilityRegistryContext } from "../../mcp/capability-registry.js"
import type { OrgRouteVariables } from "../org/shared.js"

process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"
process.env.DEN_API_PUBLIC_URL ??= "http://127.0.0.1:8790"

const principalUserId = createDenTypeId("user")
const principalOrganizationId = createDenTypeId("organization")

type AmmRunResponse = z.infer<typeof ammRunResponseSchema>
type AmmRunAcknowledgement = z.infer<typeof ammRunAcknowledgementSchema>
type AmmRunCancellationAcknowledgement = z.infer<typeof ammRunCancellationAcknowledgementSchema>
type AmmService = ReturnType<typeof import("../../amm/service.js")["createAmmService"]>
type AmmRoutesModule = typeof import("./index.js")
type AmmRouteOptions = NonNullable<Parameters<AmmRoutesModule["registerAmmRoutes"]>[1]>
type AmmClient = AmmRouteOptions["client"]
type TestApp = Hono<{ Variables: OrgRouteVariables & RequestIdVariables }>

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = () => undefined
  let reject: Deferred<T>["reject"] = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const now = new Date("2026-08-17T12:00:00.000Z")
const windowStart = new Date("2026-08-17T00:00:00.000Z")
const windowEnd = new Date("2026-08-18T00:00:00.000Z")
const terminalCollectionResult = {
  schemaVersion: "amm.kdp.managed-keyword-collection.result/v1",
  runId: "run-terminal",
  completeness: "complete",
  candidates: [{
    candidateId: "candidate_test",
    normalizedKeyword: "fantasy romance",
    searchVolume: 1200,
    totalResults: 72544,
    products: [{
      asin: "B012345678",
      title: "A Book",
      position: 1,
      price: 12.99,
      rating: 4.7,
      reviewsCount: 124,
      reviewCount: 124,
      publicationDate: "2025-01-01",
      booksRootBsr: 1234,
      bsrObservations: [{ rank: 1234, scope: "books-root", label: "#1,234 in Books" }],
    }],
  }],
  cacheHits: 1,
  providerCallsAvoided: 2,
  freshnessAsOf: "2026-08-16T12:00:00.000Z",
} as const
const publicTerminalCollectionResult = {
  schemaVersion: "amm.kdp.managed-keyword-collection.result/v1",
  completeness: "complete",
  candidates: [{
    candidateId: "candidate_test",
    normalizedKeyword: "fantasy romance",
    searchVolume: 1200,
    totalResults: 72544,
    products: [{
      asin: "B012345678",
      title: "A Book",
      position: 1,
      price: 12.99,
      rating: 4.7,
      reviewsCount: 124,
      reviewCount: 124,
      publicationDate: "2025-01-01",
      booksRootBsr: 1234,
      bsrObservations: [{ rank: 1234, scope: "books-root", label: "#1,234 in Books" }],
    }],
  }],
  cacheHits: 1,
  providerCallsAvoided: 2,
  freshnessAsOf: "2026-08-16T12:00:00.000Z",
} as const

function acknowledgeRun(run: AmmRunResponse): AmmRunAcknowledgement {
  return ammRunAcknowledgementSchema.parse({
    runId: run.runId,
    operation: run.operation,
    state: run.state,
    requestId: run.requestId,
  })
}

const { createAmmService } = await import("../../amm/service.js")
const { getCatalog } = await import("../../mcp/catalog.js")
const { registerAgentExecuteCapabilityTool } = await import("../../mcp/agent-execute.js")
const { searchCapabilities } = await import("../../mcp/search.js")
const { registerAmmRoutes } = await import("./index.js")

function cloneOperation(operation: AmmOperation): AmmOperation {
  return { ...operation }
}

function cloneBucket(bucket: AmmUsageBucket): AmmUsageBucket {
  return { ...bucket }
}

function cloneLedgerEntry(entry: AmmUsageLedgerEntry): AmmUsageLedgerEntry {
  return { ...entry }
}

class MemoryAmmStore implements AmmStore, AmmStoreTransaction {
  readonly operations = new Map<DenTypeId<"ammOperation">, AmmOperation>()
  readonly buckets = new Map<DenTypeId<"ammUsageBucket">, AmmUsageBucket>()
  readonly ledgerEntries = new Map<DenTypeId<"ammUsageLedgerEntry">, AmmUsageLedgerEntry>()
  private transactionTail = Promise.resolve()

  seedBucket(organizationId: DenTypeId<"organization">, limitUnits: number) {
    const bucket: AmmUsageBucket = {
      id: createDenTypeId("ammUsageBucket"),
      organizationId,
      limitUnits,
      reservedUnits: 0,
      usedUnits: 0,
      windowStartAt: windowStart,
      windowEndAt: windowEnd,
      createdAt: now,
      updatedAt: now,
    }
    this.buckets.set(bucket.id, bucket)
    return cloneBucket(bucket)
  }

  async transaction<T>(run: (transaction: AmmStoreTransaction) => Promise<T>): Promise<T> {
    let releaseTransaction: () => void = () => undefined
    const previousTransaction = this.transactionTail
    this.transactionTail = new Promise<void>((resolve) => {
      releaseTransaction = resolve
    })
    await previousTransaction

    const operationSnapshot = new Map(
      [...this.operations].map(([id, operation]) => [id, cloneOperation(operation)]),
    )
    const bucketSnapshot = new Map(
      [...this.buckets].map(([id, bucket]) => [id, cloneBucket(bucket)]),
    )
    const ledgerSnapshot = new Map(
      [...this.ledgerEntries].map(([id, entry]) => [id, cloneLedgerEntry(entry)]),
    )

    try {
      return await run(this)
    } catch (error) {
      this.operations.clear()
      this.buckets.clear()
      this.ledgerEntries.clear()
      for (const [id, operation] of operationSnapshot) this.operations.set(id, operation)
      for (const [id, bucket] of bucketSnapshot) this.buckets.set(id, bucket)
      for (const [id, entry] of ledgerSnapshot) this.ledgerEntries.set(id, entry)
      throw error
    } finally {
      releaseTransaction()
    }
  }

  findOwnedOperation(
    organizationId: DenTypeId<"organization">,
    operationId: DenTypeId<"ammOperation">,
  ): Promise<AmmOperation | null> {
    const operation = this.operations.get(operationId)
    return Promise.resolve(
      operation?.organizationId === organizationId ? cloneOperation(operation) : null,
    )
  }

  findOwnedOperationForUpdate(
    organizationId: DenTypeId<"organization">,
    operationId: DenTypeId<"ammOperation">,
  ) {
    return this.findOwnedOperation(organizationId, operationId)
  }

  findOperationByKey(
    organizationId: DenTypeId<"organization">,
    operationKey: string,
  ): Promise<AmmOperation | null> {
    const operation = [...this.operations.values()].find(
      (candidate) => candidate.organizationId === organizationId
        && candidate.operationKey === operationKey,
    )
    return Promise.resolve(operation ? cloneOperation(operation) : null)
  }

  findOperationByKeyForUpdate(
    organizationId: DenTypeId<"organization">,
    operationKey: string,
  ) {
    return this.findOperationByKey(organizationId, operationKey)
  }

  findActiveBucketForUpdate(
    organizationId: DenTypeId<"organization">,
    at: Date,
  ): Promise<AmmUsageBucket | null> {
    const bucket = [...this.buckets.values()].find(
      (candidate) => candidate.organizationId === organizationId
        && candidate.windowStartAt <= at
        && candidate.windowEndAt > at,
    )
    return Promise.resolve(bucket ? cloneBucket(bucket) : null)
  }

  findOperationBucketForUpdate(operation: AmmOperation): Promise<AmmUsageBucket | null> {
    const bucket = [...this.buckets.values()].find(
      (candidate) => candidate.organizationId === operation.organizationId
        && candidate.windowStartAt <= operation.createdAt
        && candidate.windowEndAt > operation.createdAt,
    )
    return Promise.resolve(bucket ? cloneBucket(bucket) : null)
  }

  insertOperation(operation: AmmOperation): Promise<void> {
    this.operations.set(operation.id, cloneOperation(operation))
    return Promise.resolve()
  }

  updateOperation(
    operationId: DenTypeId<"ammOperation">,
    update: AmmOperationUpdate,
  ): Promise<void> {
    const operation = this.operations.get(operationId)
    if (!operation) throw new Error("missing AMM operation")
    this.operations.set(operationId, { ...operation, ...update })
    return Promise.resolve()
  }

  updateBucket(
    bucketId: DenTypeId<"ammUsageBucket">,
    update: AmmUsageBucketUpdate,
  ): Promise<void> {
    const bucket = this.buckets.get(bucketId)
    if (!bucket) throw new Error("missing AMM usage bucket")
    this.buckets.set(bucketId, { ...bucket, ...update })
    return Promise.resolve()
  }

  insertLedgerEntry(entry: AmmUsageLedgerEntry): Promise<void> {
    const duplicate = [...this.ledgerEntries.values()].some(
      (candidate) => candidate.operationId === entry.operationId
        && candidate.event === entry.event,
    )
    if (duplicate) throw new Error("duplicate AMM ledger event")
    this.ledgerEntries.set(entry.id, cloneLedgerEntry(entry))
    return Promise.resolve()
  }
}

class AmmWitness {
  readonly runs = new Map<string, AmmRunResponse>()
  readonly startCalls: Array<{ idempotencyKey: string; input: StartAmmKdpKeywordCollection }> = []
  getRunCalls = 0
  cancelRunCalls = 0
  observationCalls = 0
  scoreCalls = 0
  scoreResponse: unknown = null
  cancelResponseState: "cancelled" | "running" | "succeeded" = "cancelled"
  startError: unknown = null
  startGate: { entered: Deferred<void>; release: Deferred<void> } | null = null

  async startCollection(
    input: StartAmmKdpKeywordCollection,
    context: { idempotencyKey: string; requestId: string },
  ): Promise<AmmRunAcknowledgement> {
    this.startCalls.push({ idempotencyKey: context.idempotencyKey, input })
    if (this.startGate) {
      this.startGate.entered.resolve()
      await this.startGate.release.promise
    }
    if (this.startError) throw this.startError
    const existing = this.runs.get(context.idempotencyKey)
    if (existing) return acknowledgeRun(existing)
    const run: AmmRunResponse = {
      runId: `run-${this.runs.size + 1}`,
      operation: "kdp.keyword-collection",
      state: "queued",
      result: null,
      requestId: context.requestId,
    }
    this.runs.set(context.idempotencyKey, run)
    return acknowledgeRun(run)
  }

  async getRun(runId: string, context: { requestId: string }): Promise<AmmRunResponse> {
    this.getRunCalls += 1
    const run = [...this.runs.values()].find((candidate) => candidate.runId === runId)
    if (!run) throw new Error("missing witness run")
    return { ...run, requestId: context.requestId }
  }

  async cancelRun(runId: string, context: { requestId: string }): Promise<AmmRunCancellationAcknowledgement> {
    this.cancelRunCalls += 1
    const run = await this.getRun(runId, context)
    const cancelled: AmmRunResponse = { ...run, state: this.cancelResponseState }
    this.runs.set([...this.runs.entries()].find(([, candidate]) => candidate.runId === runId)?.[0] ?? "", cancelled)
    return ammRunCancellationAcknowledgementSchema.parse(acknowledgeRun(cancelled))
  }

  getKeywordObservations(): Promise<unknown> {
    this.observationCalls += 1
    return Promise.resolve({
      keyword: "fantasy romance",
      marketplace: "amazon.com",
      freshWithinHours: 24,
      cacheHit: true,
      fresh: [{
        id: "0198b5f0-7b80-7000-8000-000000000001",
        keyword: "fantasy romance",
        marketplace: "amazon.com",
        department: "books",
        format: "paperback",
        asin: null,
        metric: "amazon_monthly_search_volume",
        value: 1200,
        observed_at: "2026-08-17T11:00:00.000Z",
        provider_id: "dataforseo",
        provider_version: "v3",
        tenantId: "tenant-private",
        run_id: "run-private",
        evidence: { source: "provider", organizationId: "org-private" },
        domain: "kdp",
        source: "amazon",
        entity_type: "keyword",
        entity_key: "fantasy romance",
        created_at: "2026-08-17T11:00:01.000Z",
      }],
      history: [],
    })
  }

  scoreKeywords(input: unknown): Promise<unknown> {
    this.scoreCalls += 1
    if (this.scoreResponse !== null) return Promise.resolve(this.scoreResponse)
    if (typeof input !== "object" || input === null || !("candidates" in input) || !Array.isArray(input.candidates)) {
      throw new Error("invalid scoring input")
    }
    const rankings = input.candidates
      .flatMap((candidate) => {
        if (typeof candidate !== "object" || candidate === null) return []
        if (!("candidateId" in candidate) || typeof candidate.candidateId !== "string") return []
        if (!("demand" in candidate) || typeof candidate.demand !== "number") return []
        if (!("competition" in candidate) || typeof candidate.competition !== "number") return []
        return [{ candidateId: candidate.candidateId, score: candidate.demand - candidate.competition }]
      })
      .sort((left, right) => right.score - left.score || (left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0))
    return Promise.resolve({ schemaVersion: "amm.kdp.keyword-scores.result/v1", rankings })
  }

  completeRun(idempotencyKey: string, usage?: AmmProviderUsage) {
    const run = this.runs.get(idempotencyKey)
    if (!run) throw new Error("missing witness run")
    this.runs.set(idempotencyKey, {
      ...run,
      state: "succeeded",
      result: { ...terminalCollectionResult, runId: run.runId },
      ...(usage ? { usage } : {}),
    })
  }
}

function organizationContext(input: {
  organizationId?: DenTypeId<"organization">
  entitled?: boolean
} = {}): OrganizationContext {
  const organizationId = input.organizationId ?? principalOrganizationId
  return {
    organization: {
      id: organizationId,
      name: "AMM Routes Test",
      slug: `amm-routes-${organizationId}`,
      logo: null,
      allowedEmailDomains: null,
      metadata: input.entitled === false ? null : JSON.stringify({ features: { ammResearch: true } }),
      createdAt: now,
      updatedAt: now,
    },
    currentMember: {
      id: createDenTypeId("member"),
      userId: principalUserId,
      role: "member",
      createdAt: now,
      joinedAt: now,
      isOwner: false,
    },
    members: [],
    invitations: [],
    roles: [],
    teams: [],
  }
}

function contextMiddleware(context: OrganizationContext): AmmRouteOptions["memberRoute"] {
  return async (c, next) => {
    c.set("organizationContext", context)
    await next()
  }
}

function routeApp(input: {
  client?: AmmClient
  context?: OrganizationContext
  service: AmmService
  startCancellationWaitMs?: number
  withOpenApi?: boolean
}) {
  const app: TestApp = new Hono<{ Variables: OrgRouteVariables & RequestIdVariables }>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-amm-routes")
    await next()
  })
  registerAmmRoutes(app, {
    client: input.client,
    memberRoute: input.context ? contextMiddleware(input.context) : undefined,
    service: input.service,
    startCancellationWaitMs: input.startCancellationWaitMs,
  })
  if (input.withOpenApi) {
    app.get("/openapi.json", openAPIRouteHandler(app, {
      documentation: { openapi: "3.1.0", info: { title: "AMM route test", version: "1" } },
    }))
  }
  return app
}

function serviceWithBucket(input: {
  limitUnits?: number
  organizationId?: DenTypeId<"organization">
} = {}) {
  const store = new MemoryAmmStore()
  store.seedBucket(input.organizationId ?? principalOrganizationId, input.limitUnits ?? 100)
  return { service: createAmmService(store, () => now), store }
}

function startBody(overrides: Partial<StartAmmKdpKeywordCollection> = {}): StartAmmKdpKeywordCollection {
  return {
    operationKey: "kdp-route-test-001",
    evaluationTargetAsOf: "2026-08-17T00:00:00.000Z",
    keyword: "fantasy romance",
    marketplace: "amazon.com",
    language: "en",
    department: "books",
    targetFormat: "paperback",
    currency: "USD",
    collectionIntent: "refresh",
    evidenceLevel: "standard",
    limits: { maxUnits: 20, maxProducts: 3, maxPages: 1, searchDepth: 3 },
    ...overrides,
  }
}

async function postJson(app: TestApp, path: string, body: unknown) {
  return app.request(`http://den-api.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function firstToolText(result: unknown) {
  if (!isRecord(result) || !Array.isArray(result.content)) throw new Error("Expected MCP tool content")
  const part = result.content.find((candidate) => isRecord(candidate) && candidate.type === "text")
  if (!isRecord(part) || typeof part.text !== "string") throw new Error("Expected MCP text content")
  return part.text
}

describe("AMM native routes", () => {
  it("requires authentication for a direct request", async () => {
    const { service } = serviceWithBucket()
    const response = await postJson(routeApp({ service }), "/v1/amm/kdp/keyword-collections", startBody())

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
  })

  it("requires the explicit AMM research entitlement before contacting AMM", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const response = await postJson(routeApp({
      client: witness,
      context: organizationContext({ entitled: false }),
      service,
    }), "/v1/amm/kdp/keyword-collections", startBody())

    expect(response.status).toBe(402)
    const payload: unknown = await response.json()
    expect(isRecord(payload) ? payload.error : undefined).toBe("amm_research_not_enabled")
    expect(isRecord(payload) ? payload.feature : undefined).toBe("ammResearch")
    expect(witness.startCalls).toHaveLength(0)
  })

  it("reserves the AMM bucket before the downstream call", async () => {
    const { service, store } = serviceWithBucket({ limitUnits: 5 })
    const witness = new AmmWitness()
    const response = await postJson(routeApp({
      client: witness,
      context: organizationContext(),
      service,
    }), "/v1/amm/kdp/keyword-collections", startBody())

    expect([402, 429]).toContain(response.status)
    expect(witness.startCalls).toHaveLength(0)
    expect(store.operations.size).toBe(0)
  })

  it("retains a recoverable reservation while downstream start remains ambiguous", async () => {
    const { service, store } = serviceWithBucket()
    const witness = new AmmWitness()
    witness.startError = new AmmClientError("amm_not_configured")
    const app = routeApp({
      client: witness,
      context: organizationContext(),
      service,
      startCancellationWaitMs: 5,
    })

    const firstResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const first: unknown = await firstResponse.json()
    const secondResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const second: unknown = await secondResponse.json()

    expect(firstResponse.status).toBe(503)
    expect(secondResponse.status).toBe(503)
    expect(second).toEqual(first)
    expect(isRecord(first) ? first.error : undefined).toBe("amm_not_configured")
    const operationId = isRecord(first) && typeof first.operationId === "string" ? first.operationId : null
    expect(operationId?.startsWith("aop_")).toBe(true)
    expect(store.operations.size).toBe(1)
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)

    if (!operationId) throw new Error("missing recoverable Den operation ID")
    const cancel = await app.request(`http://den-api.local/v1/amm/operations/${operationId}`, { method: "DELETE" })
    expect(cancel.status).toBe(409)
    expect(await cancel.json()).toEqual({ error: "amm_operation_state_conflict", operationId })
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)

    witness.startError = null
    const recoveredResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const recovered: unknown = await recoveredResponse.json()

    expect(recoveredResponse.status).toBe(202)
    expect(isRecord(recovered) ? recovered.operationId : undefined).toBe(operationId)
    expect(witness.startCalls).toHaveLength(3)
    expect(new Set(witness.startCalls.map((call) => call.idempotencyKey))).toEqual(new Set([operationId]))

    const released = await app.request(`http://den-api.local/v1/amm/operations/${operationId}`, { method: "DELETE" })
    expect(released.status).toBe(200)
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(0)
  })

  it("starts once with the Den operation ID and preserves idempotent retry", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })

    const firstResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const first: unknown = await firstResponse.json()
    const secondResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const second: unknown = await secondResponse.json()

    expect(firstResponse.status).toBe(202)
    expect(secondResponse.status).toBe(200)
    expect(second).toEqual(first)
    expect(isRecord(first) ? first.state : undefined).toBe("queued")
    expect(isRecord(first) ? first.result : undefined).toBe(null)
    expect(JSON.stringify(first)).not.toContain("run-")
    expect(witness.startCalls).toHaveLength(1)
    expect(witness.startCalls[0]?.idempotencyKey.startsWith("aop_")).toBe(true)
    expect(witness.startCalls[0]?.idempotencyKey).not.toBe(startBody().operationKey)
  })

  it("never restarts a cancelled operation whose reservation was released", async () => {
    const { service, store } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })
    const startedResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")
    await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`, { method: "DELETE" })

    const retry = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())

    expect(retry.status).toBe(409)
    expect(await retry.json()).toEqual({ error: "amm_operation_state_conflict" })
    expect(witness.startCalls).toHaveLength(1)
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(0)
  })

  it("recovers a prior accepted start after attachment failure and reconciles a terminal acknowledgement", async () => {
    const { service, store } = serviceWithBucket()
    let attachCalls = 0
    const attachFailsOnceService: AmmService = {
      ...service,
      attachAmmRun: async (input) => {
        attachCalls += 1
        if (attachCalls === 1) throw new Error("private database diagnostic")
        return service.attachAmmRun(input)
      },
    }
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service: attachFailsOnceService })

    const firstResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const first: unknown = await firstResponse.json()
    const operationId = isRecord(first) && typeof first.operationId === "string" ? first.operationId : null
    const idempotencyKey = witness.startCalls[0]?.idempotencyKey
    if (!operationId || !idempotencyKey) throw new Error("missing recoverable operation")
    witness.completeRun(idempotencyKey, {
      capabilityUnits: 7,
      providerCalls: 3,
      upstreamCostUsd: "1.25",
    })

    const recoveredResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const recovered: unknown = await recoveredResponse.json()

    expect(firstResponse.status).toBe(502)
    expect(first).toEqual({ error: "amm_request_failed", operationId })
    expect(recoveredResponse.status).toBe(200)
    expect(recovered).toEqual({
      operationId,
      state: "succeeded",
      result: publicTerminalCollectionResult,
      usage: { capabilityUnits: 7, providerCalls: 3, upstreamCostUsd: "1.25" },
    })
    expect(witness.startCalls).toHaveLength(2)
    expect(witness.startCalls[1]?.idempotencyKey).toBe(idempotencyKey)
    expect(store.ledgerEntries.size).toBe(1)
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(0)
  })

  it("returns a recoverable safe error for a raw attachment failure", async () => {
    const { service, store } = serviceWithBucket()
    const rawFailureService: AmmService = {
      ...service,
      attachAmmRun: () => Promise.reject(new Error("private database diagnostic")),
    }
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service: rawFailureService })

    const response = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const payload: unknown = await response.json()

    expect(response.status).toBe(502)
    expect(isRecord(payload) ? payload.error : undefined).toBe("amm_request_failed")
    expect(isRecord(payload) && typeof payload.operationId === "string").toBe(true)
    expect(JSON.stringify(payload)).not.toContain("database diagnostic")
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)
  })

  it("returns the reserved operation ID when the start claim disappears", async () => {
    const { service, store } = serviceWithBucket()
    const missingClaimService: AmmService = {
      ...service,
      beginAmmOperationStart: async (input) => {
        await service.beginAmmOperationStart(input)
        return null
      },
    }
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service: missingClaimService })

    const response = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const payload: unknown = await response.json()
    const operationId = [...store.operations.values()][0]?.id

    expect(response.status).toBe(502)
    expect(payload).toEqual({ error: "amm_request_failed", operationId })
    expect(witness.startCalls).toHaveLength(0)
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)
  })

  it("reconciles a terminal idempotent start retry exactly once", async () => {
    const { service, store } = serviceWithBucket()
    let reconciliationCalls = 0
    const countedService: AmmService = {
      ...service,
      reconcileAmmOperation: async (input) => {
        reconciliationCalls += 1
        return service.reconcileAmmOperation(input)
      },
    }
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service: countedService })
    await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const idempotencyKey = witness.startCalls[0]?.idempotencyKey
    if (!idempotencyKey) throw new Error("missing downstream idempotency key")
    witness.completeRun(idempotencyKey, {
      capabilityUnits: 7,
      providerCalls: 3,
      upstreamCostUsd: "1.25",
    })

    const firstRetry = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const secondRetry = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())

    expect(firstRetry.status).toBe(200)
    expect(secondRetry.status).toBe(200)
    const terminalPayload = {
      operationId: witness.startCalls[0]?.idempotencyKey,
      state: "succeeded",
      result: publicTerminalCollectionResult,
      usage: { capabilityUnits: 7, providerCalls: 3, upstreamCostUsd: "1.25" },
    }
    expect(await firstRetry.json()).toEqual(terminalPayload)
    expect(await secondRetry.json()).toEqual(terminalPayload)
    expect(store.ledgerEntries.size).toBe(1)
    expect(reconciliationCalls).toBe(1)
    expect(witness.startCalls).toHaveLength(1)
  })

  it("rejects reuse of an operation key with a different request body", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })
    await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())

    const response = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody({ keyword: "cozy mystery" }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "amm_operation_conflict" })
    expect(witness.startCalls).toHaveLength(1)
  })

  it("hides another organization's operation from reads and cancellation", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const ownerApp = routeApp({ client: witness, context: organizationContext(), service })
    const startedResponse = await postJson(ownerApp, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")
    const otherOrganizationId = createDenTypeId("organization")
    const otherApp = routeApp({
      client: witness,
      context: organizationContext({ organizationId: otherOrganizationId }),
      service,
    })

    const read = await otherApp.request(`http://den-api.local/v1/amm/operations/${started.operationId}`)
    const cancel = await otherApp.request(`http://den-api.local/v1/amm/operations/${started.operationId}`, { method: "DELETE" })

    expect(read.status).toBe(404)
    expect(cancel.status).toBe(404)
    expect(witness.getRunCalls).toBe(0)
    expect(witness.cancelRunCalls).toBe(0)
  })

  it("cancels an owned operation from the strict acknowledgement without exposing a run ID", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })
    const startedResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")

    const response = await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`, { method: "DELETE" })
    const payload: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ operationId: started.operationId, state: "cancelled", result: null })
    expect(JSON.stringify(payload)).not.toContain("run-")
    expect(witness.cancelRunCalls).toBe(1)
  })

  it.each(["running", "succeeded"] as const)("does not release quota for a %s cancellation acknowledgement", async (state) => {
    const { service, store } = serviceWithBucket()
    const witness = new AmmWitness()
    witness.cancelResponseState = state
    const app = routeApp({ client: witness, context: organizationContext(), service })
    const startedResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")

    const response = await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`, { method: "DELETE" })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "amm_invalid_response" })
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)
    expect([...store.operations.values()][0]?.state).toBe("running")
  })

  it("waits for an in-flight start to attach before cancelling it and releasing quota", async () => {
    const { service, store } = serviceWithBucket()
    const witness = new AmmWitness()
    witness.startGate = { entered: deferred<void>(), release: deferred<void>() }
    const app = routeApp({
      client: witness,
      context: organizationContext(),
      service,
      startCancellationWaitMs: 250,
    })

    const startPromise = postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    await witness.startGate.entered.promise
    const operation = [...store.operations.values()][0]
    if (!operation) throw new Error("missing in-flight Den operation")
    const cancelPromise = Promise.resolve(app.request(`http://den-api.local/v1/amm/operations/${operation.id}`, { method: "DELETE" }))
    let cancelSettled = false
    void cancelPromise.then(() => {
      cancelSettled = true
    })
    await Promise.resolve()

    expect(operation.state).toBe("running")
    expect(operation.ammRunId).toBe(null)
    expect(cancelSettled).toBe(false)
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)

    witness.startGate.release.resolve()
    const [startResponse, cancelResponse] = await Promise.all([startPromise, cancelPromise])

    expect(startResponse.status).toBe(202)
    expect(cancelResponse.status).toBe(200)
    expect(witness.startCalls).toHaveLength(1)
    expect(witness.cancelRunCalls).toBe(1)
    expect([...store.operations.values()][0]?.state).toBe("cancelled")
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(0)
  })

  it("returns a stable conflict without releasing quota when an in-flight start remains unresolved", async () => {
    const { service, store } = serviceWithBucket()
    const witness = new AmmWitness()
    witness.startGate = { entered: deferred<void>(), release: deferred<void>() }
    const app = routeApp({
      client: witness,
      context: organizationContext(),
      service,
      startCancellationWaitMs: 5,
    })

    const startPromise = postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    await witness.startGate.entered.promise
    const operation = [...store.operations.values()][0]
    if (!operation) throw new Error("missing in-flight Den operation")

    const response = await app.request(`http://den-api.local/v1/amm/operations/${operation.id}`, { method: "DELETE" })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "amm_operation_state_conflict",
      operationId: operation.id,
    })
    expect(witness.cancelRunCalls).toBe(0)
    expect([...store.operations.values()][0]?.state).toBe("running")
    expect([...store.operations.values()][0]?.ammRunId).toBe(null)
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)

    witness.startGate.release.resolve()
    expect((await startPromise).status).toBe(202)
  })

  it("returns a terminal result and reconciles its usage exactly once", async () => {
    const { service, store } = serviceWithBucket()
    let reconciliationCalls = 0
    const countedService: AmmService = {
      ...service,
      reconcileAmmOperation: async (input) => {
        reconciliationCalls += 1
        return service.reconcileAmmOperation(input)
      },
    }
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service: countedService })
    const startedResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")
    const idempotencyKey = witness.startCalls[0]?.idempotencyKey
    if (!idempotencyKey) throw new Error("missing downstream idempotency key")
    witness.completeRun(idempotencyKey, {
      capabilityUnits: 7,
      providerCalls: 3,
      upstreamCostUsd: "1.25",
    })

    const first = await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`)
    const second = await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`)
    const firstPayload: unknown = await first.json()
    const secondPayload: unknown = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(secondPayload).toEqual(firstPayload)
    expect(firstPayload).toEqual({
      operationId: started.operationId,
      state: "succeeded",
      result: publicTerminalCollectionResult,
      usage: { capabilityUnits: 7, providerCalls: 3, upstreamCostUsd: "1.25" },
    })
    expect(JSON.stringify(firstPayload)).not.toContain("run-")
    expect(JSON.stringify(firstPayload)).not.toContain("tenant-private")
    expect(store.ledgerEntries.size).toBe(1)
    expect([...store.ledgerEntries.values()][0]?.quantityUnits).toBe(7)
    expect(reconciliationCalls).toBe(1)
  })

  it("rejects cancellation of a completed operation before contacting AMM", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })
    const startedResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")
    const idempotencyKey = witness.startCalls[0]?.idempotencyKey
    if (!idempotencyKey) throw new Error("missing downstream idempotency key")
    witness.completeRun(idempotencyKey, {
      capabilityUnits: 7,
      providerCalls: 3,
      upstreamCostUsd: "1.25",
    })
    await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`)

    const response = await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`, { method: "DELETE" })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "amm_operation_state_conflict" })
    expect(witness.cancelRunCalls).toBe(0)
  })

  it("rejects a terminal run without usage and keeps its reservation unreconciled", async () => {
    const { service, store } = serviceWithBucket()
    let reconciliationCalls = 0
    const countedService: AmmService = {
      ...service,
      reconcileAmmOperation: async (input) => {
        reconciliationCalls += 1
        return service.reconcileAmmOperation(input)
      },
    }
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service: countedService })
    const startedResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")
    const idempotencyKey = witness.startCalls[0]?.idempotencyKey
    if (!idempotencyKey) throw new Error("missing downstream idempotency key")
    witness.completeRun(idempotencyKey)

    const response = await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "amm_invalid_response" })
    expect(store.ledgerEntries.size).toBe(0)
    expect([...store.operations.values()][0]?.state).toBe("running")
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)
    expect(reconciliationCalls).toBe(0)
  })

  it("rejects a terminal KDP result that includes a signed URL field", async () => {
    const { service, store } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })
    const startedResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")
    const idempotencyKey = witness.startCalls[0]?.idempotencyKey
    if (!idempotencyKey) throw new Error("missing downstream idempotency key")
    const run = witness.runs.get(idempotencyKey)
    if (!run) throw new Error("missing witness run")
    witness.runs.set(idempotencyKey, {
      ...run,
      state: "succeeded",
      result: {
        ...terminalCollectionResult,
        runId: run.runId,
        candidates: [{
          ...terminalCollectionResult.candidates[0],
          products: [{
            ...terminalCollectionResult.candidates[0].products[0],
            detailPageUrl: "https://example.invalid/product?X-Amz-Signature=secret",
          }],
        }],
      },
      usage: { capabilityUnits: 7, providerCalls: 3, upstreamCostUsd: "1.25" },
    })

    const response = await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "amm_invalid_response" })
    expect(store.ledgerEntries.size).toBe(0)
    expect([...store.operations.values()][0]?.state).toBe("running")
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)
  })

  it.each(["queued", "running"] as const)("rejects a nonterminal KDP %s result on the public operation route", async (state) => {
    const { service, store } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })
    const startedResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")
    const idempotencyKey = witness.startCalls[0]?.idempotencyKey
    if (!idempotencyKey) throw new Error("missing downstream idempotency key")
    const run = witness.runs.get(idempotencyKey)
    if (!run) throw new Error("missing witness run")
    witness.runs.set(idempotencyKey, {
      ...run,
      state,
      result: { ...terminalCollectionResult, runId: run.runId },
    })

    const response = await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "amm_invalid_response" })
    expect(store.ledgerEntries.size).toBe(0)
    expect([...store.operations.values()][0]?.state).toBe("running")
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)
  })

  it("rejects a terminal KDP result whose embedded runId mismatches the run envelope", async () => {
    const { service, store } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })
    const startedResponse = await postJson(app, "/v1/amm/kdp/keyword-collections", startBody())
    const started: unknown = await startedResponse.json()
    if (!isRecord(started) || typeof started.operationId !== "string") throw new Error("missing Den operation ID")
    const idempotencyKey = witness.startCalls[0]?.idempotencyKey
    if (!idempotencyKey) throw new Error("missing downstream idempotency key")
    const run = witness.runs.get(idempotencyKey)
    if (!run) throw new Error("missing witness run")
    witness.runs.set(idempotencyKey, {
      ...run,
      state: "succeeded",
      result: {
        ...terminalCollectionResult,
        runId: "run_other",
      },
      usage: { capabilityUnits: 7, providerCalls: 3, upstreamCostUsd: "1.25" },
    })

    const response = await app.request(`http://den-api.local/v1/amm/operations/${started.operationId}`)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "amm_invalid_response" })
    expect(store.ledgerEntries.size).toBe(0)
    expect([...store.operations.values()][0]?.state).toBe("running")
    expect([...store.buckets.values()][0]?.reservedUnits).toBe(20)
  })

  it("returns observations without customer or downstream run linkage", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })

    const response = await app.request("http://den-api.local/v1/amm/kdp/keyword-observations?keyword=fantasy%20romance")
    const payload: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      keyword: "fantasy romance",
      marketplace: "amazon.com",
      freshWithinHours: 24,
      cacheHit: true,
      fresh: [{
        id: "0198b5f0-7b80-7000-8000-000000000001",
        keyword: "fantasy romance",
        marketplace: "amazon.com",
        department: "books",
        format: "paperback",
        asin: null,
        metric: "amazon_monthly_search_volume",
        value: 1200,
        observed_at: "2026-08-17T11:00:00.000Z",
        provider_id: "dataforseo",
        provider_version: "v3",
        evidence: { source: "provider" },
        domain: "kdp",
        source: "amazon",
        entity_type: "keyword",
        entity_key: "fantasy romance",
        created_at: "2026-08-17T11:00:01.000Z",
      }],
      history: [],
    })
    expect(JSON.stringify(payload)).not.toContain("tenant-private")
    expect(JSON.stringify(payload)).not.toContain("run-private")
    expect(JSON.stringify(payload)).not.toContain("org-private")
    expect(witness.observationCalls).toBe(1)
  })

  it("returns deterministic synchronous scoring without creating a run", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })
    const body = {
      schemaVersion: "amm.kdp.keyword-scores.request/v1",
      candidates: [
        { candidateId: "b", demand: 70, competition: 20 },
        { candidateId: "a", demand: 70, competition: 20 },
        { candidateId: "c", demand: 60, competition: 30 },
      ],
    }

    const first = await postJson(app, "/v1/amm/kdp/keyword-scores", body)
    const second = await postJson(app, "/v1/amm/kdp/keyword-scores", body)

    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      schemaVersion: "amm.kdp.keyword-scores.result/v1",
      rankings: [
        { candidateId: "a", score: 50 },
        { candidateId: "b", score: 50 },
        { candidateId: "c", score: 30 },
      ],
    })
    expect(await second.json()).toEqual({
      schemaVersion: "amm.kdp.keyword-scores.result/v1",
      rankings: [
        { candidateId: "a", score: 50 },
        { candidateId: "b", score: 50 },
        { candidateId: "c", score: 30 },
      ],
    })
    expect(witness.startCalls).toHaveLength(0)
    expect(witness.runs.size).toBe(0)
  })

  it("uses locale-independent candidate ID ordering to break scoring ties", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({ client: witness, context: organizationContext(), service })

    const response = await postJson(app, "/v1/amm/kdp/keyword-scores", {
      schemaVersion: "amm.kdp.keyword-scores.request/v1",
      candidates: [
        { candidateId: "ä", demand: 70, competition: 20 },
        { candidateId: "z", demand: 70, competition: 20 },
      ],
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      schemaVersion: "amm.kdp.keyword-scores.result/v1",
      rankings: [
        { candidateId: "z", score: 50 },
        { candidateId: "ä", score: 50 },
      ],
    })
  })

  it("maps an invalid downstream scoring response to a stable error", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    witness.scoreResponse = { rankings: [{ candidateId: "missing-schema", score: 1 }] }
    const app = routeApp({ client: witness, context: organizationContext(), service })

    const response = await postJson(app, "/v1/amm/kdp/keyword-scores", {
      schemaVersion: "amm.kdp.keyword-scores.request/v1",
      candidates: [{ candidateId: "candidate", demand: 60, competition: 20 }],
    })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "amm_invalid_response" })
  })

  for (const [kind, rankings] of [
    ["duplicate", [
      { candidateId: "a", score: 50 },
      { candidateId: "a", score: 50 },
    ]],
    ["foreign", [
      { candidateId: "a", score: 50 },
      { candidateId: "foreign", score: 40 },
    ]],
    ["missing", [
      { candidateId: "a", score: 50 },
    ]],
    ["unsorted", [
      { candidateId: "b", score: 40 },
      { candidateId: "a", score: 50 },
    ]],
    ["misscored", [
      { candidateId: "a", score: 49 },
      { candidateId: "b", score: 40 },
    ]],
  ] as const) {
    it(`rejects a ${kind} downstream scoring witness`, async () => {
      const { service } = serviceWithBucket()
      const witness = new AmmWitness()
      witness.scoreResponse = {
        schemaVersion: "amm.kdp.keyword-scores.result/v1",
        rankings,
      }
      const app = routeApp({ client: witness, context: organizationContext(), service })

      const response = await postJson(app, "/v1/amm/kdp/keyword-scores", {
        schemaVersion: "amm.kdp.keyword-scores.request/v1",
        candidates: [
          { candidateId: "a", demand: 70, competition: 20 },
          { candidateId: "b", demand: 60, competition: 20 },
        ],
      })

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: "amm_invalid_response" })
    })
  }
})

describe("AMM MCP discovery", () => {
  it("discovers the native KDP research operations and executes execute_capability over MCP", async () => {
    const { service } = serviceWithBucket()
    const witness = new AmmWitness()
    const app = routeApp({
      client: witness,
      context: organizationContext(),
      service,
      withOpenApi: true,
    })

    const catalog = await getCatalog(app as unknown as Hono, undefined)
    expect(catalog
      .filter((operation) => operation.operation.tags?.includes("AMM Research"))
      .map((operation) => operation.name)
      .sort()).toEqual([
      "cancelAmmResearchOperation",
      "getAmmKdpKeywordObservations",
      "getAmmResearchOperation",
      "scoreAmmKdpKeywords",
      "startAmmKdpKeywordCollection",
    ])
    const matches = searchCapabilities(catalog, "kdp keyword research scoring", 20)
    const names = matches.map((match) => match.name)
    expect(names).toContain("startAmmKdpKeywordCollection")
    expect(names).toContain("getAmmResearchOperation")
    expect(names).toContain("cancelAmmResearchOperation")
    expect(names).toContain("getAmmKdpKeywordObservations")
    expect(names).toContain("scoreAmmKdpKeywords")

    const principal = {
      userId: principalUserId,
      organizationId: principalOrganizationId,
      scopes: new Set(["mcp:read", "mcp:write"]),
      payload: {},
    }
    const capabilityContext: CapabilityRegistryContext = {
      app: app as unknown as Hono,
      env: undefined,
      catalog,
      principal,
      organizationId: principalOrganizationId,
      member: null,
      redirectUriBase: "http://den-api.local",
      codemodeEnabled: false,
      generatedArtifactViewsEnabled: false,
      externalMcpConnectionsEnabled: false,
      resolvePlatformAdmin: () => Promise.resolve(false),
      resolveNamespaceContext: () => Promise.reject(new Error("namespace context is not needed for a Den catalog capability")),
    }
    const server = new McpServer({ name: "openwork-den-api-agent", version: "1.0.0" })
    registerAgentExecuteCapabilityTool({ server, catalog, capabilityContext })
    const client = new Client({ name: "amm-agent-client", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const result = await client.callTool({
      name: "execute_capability",
      arguments: {
        name: "scoreAmmKdpKeywords",
        body: {
          schemaVersion: "amm.kdp.keyword-scores.request/v1",
          candidates: [
            { candidateId: "strong", demand: 80, competition: 20 },
            { candidateId: "weak", demand: 40, competition: 30 },
          ],
        },
      },
    })

    await client.close()
    await server.close()

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(firstToolText(result))).toEqual({
      schemaVersion: "amm.kdp.keyword-scores.result/v1",
      rankings: [
        { candidateId: "strong", score: 60 },
        { candidateId: "weak", score: 10 },
      ],
    })
    expect(witness.scoreCalls).toBe(1)
    expect(witness.startCalls).toHaveLength(0)
  })
})
