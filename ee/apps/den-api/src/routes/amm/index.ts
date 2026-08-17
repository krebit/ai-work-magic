import { createHash } from "node:crypto"
import type { DenTypeId } from "@openwork-ee/utils/typeid"
import type { Hono } from "hono"
import type { RequestIdVariables } from "hono/request-id"
import { describeRoute, type DescribeRouteOptions } from "hono-openapi"
import { z } from "zod"
import { AmmClientError, AmmResearchClient } from "../../amm/client.js"
import {
  ammKeywordObservationQuerySchema,
  parseAmmRunResponse,
  ammProviderUsageSchema,
  ammOperationParamsSchema,
  ammRunResponseSchema,
  scoreAmmKdpKeywordsSchema,
  startAmmKdpKeywordCollectionSchema,
} from "../../amm/contracts.js"
import {
  AmmServiceError,
  attachAmmRun,
  beginAmmOperationStart,
  cancelOwnedAmmOperation,
  getOwnedAmmOperation,
  prepareAmmOperationCancellation,
  reconcileAmmOperation,
  reserveAmmOperation,
  type AmmOperation,
} from "../../amm/service.js"
import { checkEntitlement } from "../../entitlements.js"
import { env } from "../../env.js"
import {
  jsonValidator,
  paramValidator,
  queryValidator,
} from "../../middleware/validation.js"
import {
  resolveOrganizationContextMiddleware,
  type OrganizationContextVariables,
} from "../../middleware/organization-context.js"
import {
  denTypeIdSchema,
  invalidRequestSchema,
  jsonResponse,
  notFoundSchema,
  unauthorizedSchema,
} from "../../openapi.js"
import type { OrgRouteVariables } from "../org/shared.js"

type AmmRouteVariables = OrgRouteVariables & RequestIdVariables
type McpDescribeRouteOptions = DescribeRouteOptions & { "x-mcp": true }

const describeMcpRoute = (options: McpDescribeRouteOptions) => describeRoute(options)
const ammRouteOperationParamsSchema = ammOperationParamsSchema.extend({
  operationId: denTypeIdSchema("ammOperation"),
}).strict()

const ammResearchNotEnabledSchema = z.object({
  error: z.literal("amm_research_not_enabled"),
  feature: z.literal("ammResearch"),
  message: z.string(),
}).strict()

const ammRouteErrorSchema = z.object({
  error: z.enum([
    "amm_idempotency_conflict",
    "amm_invalid_response",
    "amm_not_configured",
    "amm_operation_conflict",
    "amm_operation_state_conflict",
    "amm_quota_exceeded",
    "amm_rate_limited",
    "amm_request_failed",
    "amm_timeout",
    "amm_unauthorized",
    "amm_upstream_error",
    "amm_usage_bucket_not_found",
  ]),
  operationId: denTypeIdSchema("ammOperation").optional(),
}).strict()

const publicRunStateSchema = z.enum([
  "reserved",
  "queued",
  "running",
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled",
  "expired",
])

const ammOperationResponseSchema = z.object({
  operationId: denTypeIdSchema("ammOperation"),
  state: publicRunStateSchema,
  result: z.unknown().nullable(),
  usage: ammProviderUsageSchema.optional(),
}).strict()

const observationRecordSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  marketplace: z.string(),
  department: z.string(),
  format: z.string(),
  asin: z.string().nullable(),
  metric: z.string(),
  value: z.unknown(),
  observed_at: z.string().datetime({ offset: true }),
  provider_id: z.string(),
  provider_version: z.string().nullable(),
  evidence: z.unknown(),
  domain: z.string(),
  source: z.string(),
  entity_type: z.string(),
  entity_key: z.string(),
  created_at: z.string().datetime({ offset: true }),
}).strict()
const ammKeywordObservationResponseSchema = z.object({
  keyword: z.string(),
  marketplace: z.string(),
  freshWithinHours: z.number().int(),
  fresh: z.array(observationRecordSchema),
  history: z.array(observationRecordSchema),
  cacheHit: z.boolean(),
}).strict()

const ammKeywordScoreResponseSchema = z.object({
  schemaVersion: z.literal("amm.kdp.keyword-scores.result/v1"),
  rankings: z.array(z.object({
    candidateId: z.string().trim().min(1).max(128),
    score: z.number(),
  }).strict()),
}).strict()

const downstreamKeywordScoreResponseSchema = ammKeywordScoreResponseSchema.extend({
  requestId: z.string().optional(),
}).strict()

const forbiddenPublicFieldNames = new Set([
  "memberId",
  "member_id",
  "organizationId",
  "organization_id",
  "reservationId",
  "reservation_id",
  "runId",
  "run_id",
  "subscriptionId",
  "subscription_id",
  "tenantId",
  "tenant_id",
  "userId",
  "user_id",
])

const terminalRunStates = new Set([
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled",
  "expired",
])

export type AmmRouteService = {
  attachAmmRun: typeof attachAmmRun
  beginAmmOperationStart: typeof beginAmmOperationStart
  cancelOwnedAmmOperation: typeof cancelOwnedAmmOperation
  getOwnedAmmOperation: typeof getOwnedAmmOperation
  prepareAmmOperationCancellation: typeof prepareAmmOperationCancellation
  reconcileAmmOperation: typeof reconcileAmmOperation
  reserveAmmOperation: typeof reserveAmmOperation
}

export type AmmRouteClient = Pick<
  AmmResearchClient,
  "cancelRun" | "getKeywordObservations" | "getRun" | "scoreKeywords" | "startCollection"
>

export type AmmRouteOptions = {
  client?: AmmRouteClient
  memberRoute?: typeof resolveOrganizationContextMiddleware
  service?: AmmRouteService
  startCancellationWaitMs?: number
}

const defaultService: AmmRouteService = {
  attachAmmRun,
  beginAmmOperationStart,
  cancelOwnedAmmOperation,
  getOwnedAmmOperation,
  prepareAmmOperationCancellation,
  reconcileAmmOperation,
  reserveAmmOperation,
}

function requestDigest(input: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`
}

function stripPrivateFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPrivateFields)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbiddenPublicFieldNames.has(key))
      .map(([key, entry]) => [key, stripPrivateFields(entry)]),
  )
}

function routeFailure(error: unknown): {
  body: { error: z.infer<typeof ammRouteErrorSchema>["error"] }
  status: 402 | 409 | 429 | 502 | 503 | 504
} | null {
  if (error instanceof z.ZodError) {
    return { body: { error: "amm_invalid_response" }, status: 502 }
  }

  if (error instanceof AmmServiceError) {
    if (error.code === "amm_quota_exceeded") {
      return { body: { error: error.code }, status: 429 }
    }
    if (error.code === "amm_usage_bucket_not_found") {
      return { body: { error: error.code }, status: 402 }
    }
    if (error.code === "amm_operation_conflict" || error.code === "amm_operation_state_conflict") {
      return { body: { error: error.code }, status: 409 }
    }
    if (error.code === "amm_invalid_usage") {
      return { body: { error: "amm_invalid_response" }, status: 502 }
    }
    return null
  }

  if (error instanceof AmmClientError) {
    if (error.code === "amm_not_configured") return { body: { error: error.code }, status: 503 }
    if (error.code === "amm_idempotency_conflict") return { body: { error: error.code }, status: 409 }
    if (error.code === "amm_rate_limited") return { body: { error: error.code }, status: 429 }
    if (error.code === "amm_timeout") return { body: { error: error.code }, status: 504 }
    return { body: { error: error.code }, status: 502 }
  }

  return null
}

function validateRunResponse(response: unknown) {
  const parsed = parseAmmRunResponse(response)
  if (!parsed.success) throw new AmmClientError("amm_invalid_response")
  return parsed.data
}

function publicRunResponse(input: {
  operationId: DenTypeId<"ammOperation">
  result: unknown
  state: z.infer<typeof publicRunStateSchema>
  usage?: z.infer<typeof ammProviderUsageSchema>
}) {
  return ammOperationResponseSchema.parse({
    operationId: input.operationId,
    state: input.state,
    result: stripPrivateFields(input.result),
    ...(input.usage ? { usage: input.usage } : {}),
  })
}

async function reconcileTerminalRun(input: {
  organizationId: DenTypeId<"organization">
  operation: Pick<AmmOperation, "id" | "state">
  run: z.infer<typeof ammRunResponseSchema>
  service: AmmRouteService
}) {
  if (!terminalRunStates.has(input.run.state)) return
  if (!input.run.usage) throw new AmmClientError("amm_invalid_response")
  if (input.operation.state === "completed") return
  await input.service.reconcileAmmOperation({
    organizationId: input.organizationId,
    operationId: input.operation.id,
    actualUnits: input.run.usage.capabilityUnits,
    providerCalls: input.run.usage.providerCalls,
    upstreamCostUsd: input.run.usage.upstreamCostUsd,
  })
}

function verifiedKeywordScoreResponse(
  input: z.infer<typeof scoreAmmKdpKeywordsSchema>,
  response: unknown,
) {
  const downstream = downstreamKeywordScoreResponseSchema.parse(response)
  const expected = input.candidates
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      score: candidate.demand - candidate.competition,
    }))
    .sort((left, right) => right.score - left.score || compareCandidateIds(left.candidateId, right.candidateId))

  const matchesExpected = downstream.rankings.length === expected.length
    && expected.every((ranking, index) => {
      const received = downstream.rankings[index]
      return received?.candidateId === ranking.candidateId && received.score === ranking.score
    })
  if (!matchesExpected) throw new AmmClientError("amm_invalid_response")

  return ammKeywordScoreResponseSchema.parse({
    schemaVersion: downstream.schemaVersion,
    rankings: downstream.rankings,
  })
}

function compareCandidateIds(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

async function prepareCancellationAfterStart(input: {
  organizationId: DenTypeId<"organization">
  operationId: DenTypeId<"ammOperation">
  service: AmmRouteService
  waitMs: number
}) {
  let prepared = await input.service.prepareAmmOperationCancellation({
    organizationId: input.organizationId,
    operationId: input.operationId,
  })
  if (prepared?.kind !== "start_pending") return prepared

  const deadline = Date.now() + input.waitMs
  let retryDelayMs = 5
  while (prepared.kind === "start_pending" && Date.now() < deadline) {
    await wait(Math.min(retryDelayMs, Math.max(1, deadline - Date.now())))
    retryDelayMs = Math.min(retryDelayMs * 2, 100)
    prepared = await input.service.prepareAmmOperationCancellation({
      organizationId: input.organizationId,
      operationId: input.operationId,
    })
    if (!prepared) return null
  }
  return prepared
}

function entitlementFor(c: {
  get(name: "organizationContext"): OrganizationContextVariables["organizationContext"]
}) {
  const organization = c.get("organizationContext")
  return checkEntitlement(organization.organization.metadata, "ammResearch")
}

function operationResponses(description: string) {
  return {
    200: jsonResponse(description, ammOperationResponseSchema),
    400: jsonResponse("The request was invalid.", invalidRequestSchema),
    401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
    402: jsonResponse("AMM research access or a usage bucket is required.", z.union([
      ammResearchNotEnabledSchema,
      ammRouteErrorSchema,
    ])),
    404: jsonResponse("The AMM operation was not found.", notFoundSchema),
    409: jsonResponse("The AMM operation conflicts with its existing request or state.", ammRouteErrorSchema),
    429: jsonResponse("The AMM usage bucket is exhausted or the downstream service is rate limited.", ammRouteErrorSchema),
    502: jsonResponse("The AMM service rejected the request or returned an invalid response.", ammRouteErrorSchema),
    503: jsonResponse("The AMM service is not configured.", ammRouteErrorSchema),
    504: jsonResponse("The AMM service timed out.", ammRouteErrorSchema),
  }
}

export function registerAmmRoutes<T extends { Variables: AmmRouteVariables }>(
  app: Hono<T>,
  options: AmmRouteOptions = {},
) {
  const client = options.client ?? new AmmResearchClient({ config: env.amm })
  const service = options.service ?? defaultService
  const orgMemberRouteMiddleware = options.memberRoute ?? resolveOrganizationContextMiddleware
  const startCancellationWaitMs = options.startCancellationWaitMs ?? env.amm?.timeoutMs ?? 10_000

  app.post(
    "/v1/amm/kdp/keyword-collections",
    describeMcpRoute({
      "x-mcp": true,
      operationId: "startAmmKdpKeywordCollection",
      tags: ["AMM Research"],
      summary: "Start KDP keyword research collection",
      description: "Reserves the organization's AMM quota and starts a bounded KDP keyword evidence collection. Returns only the durable Den operation ID.",
      responses: {
        ...operationResponses("The KDP keyword research collection is already running."),
        202: jsonResponse("The KDP keyword research collection was accepted.", ammOperationResponseSchema),
      },
    }),
    orgMemberRouteMiddleware,
    jsonValidator(startAmmKdpKeywordCollectionSchema),
    async (c) => {
      const entitlement = entitlementFor(c)
      if (!entitlement.ok) return c.json(entitlement.response, entitlement.status)
      const organization = c.get("organizationContext")
      const input = c.req.valid("json")
      let reservedOperation: AmmOperation | undefined
      try {
        const reserved = await service.reserveAmmOperation({
          organizationId: organization.organization.id,
          orgMembershipId: organization.currentMember.id,
          operationKey: input.operationKey,
          requestDigest: requestDigest(input),
          capability: "kdp.keyword-collection",
          maximumUnits: input.limits.maxUnits,
        })
        reservedOperation = reserved
        // A completed operation is a terminal idempotent replay. Return the
        // same public operation/result without reserving quota or starting a
        // second downstream run.
        if (reserved.state === "completed" && reserved.ammRunId) {
          const run = validateRunResponse(
            await client.getRun(reserved.ammRunId, { requestId: c.get("requestId") }),
          )
          await reconcileTerminalRun({
            organizationId: organization.organization.id,
            operation: reserved,
            run,
            service,
          })
          return c.json(publicRunResponse({
            operationId: reserved.id,
            state: run.state,
            result: run.result,
            usage: run.usage,
          }))
        }
        const operation = await service.beginAmmOperationStart({
          organizationId: organization.organization.id,
          operationId: reserved.id,
        })
        if (!operation) throw new Error("AMM operation disappeared after reservation")
        if (operation.ammRunId) {
          const run = validateRunResponse(
            await client.getRun(operation.ammRunId, { requestId: c.get("requestId") }),
          )
          await reconcileTerminalRun({
            organizationId: organization.organization.id,
            operation,
            run,
            service,
          })
          return c.json(publicRunResponse({
            operationId: operation.id,
            state: run.state,
            result: run.result,
            usage: run.usage,
          }))
        }

        const run = await client.startCollection(input, {
          idempotencyKey: operation.id,
          requestId: c.get("requestId"),
        })
        const attached = await service.attachAmmRun({
          organizationId: organization.organization.id,
          operationId: operation.id,
          ammRunId: run.runId,
        })
        if (!attached) throw new AmmServiceError("amm_operation_state_conflict")
        if (terminalRunStates.has(run.state)) {
          const terminalRun = validateRunResponse(
            await client.getRun(run.runId, { requestId: c.get("requestId") }),
          )
          await reconcileTerminalRun({
            organizationId: organization.organization.id,
            operation: attached,
            run: terminalRun,
            service,
          })
          return c.json(publicRunResponse({
            operationId: attached.id,
            state: terminalRun.state,
            result: terminalRun.result,
            usage: terminalRun.usage,
          }))
        }
        return c.json(publicRunResponse({
          operationId: attached.id,
          state: run.state,
          result: null,
        }), 202)
      } catch (error) {
        const failure = routeFailure(error)
        if (failure) {
          return c.json(reservedOperation
            ? { ...failure.body, operationId: reservedOperation.id }
            : failure.body, failure.status)
        }
        if (reservedOperation) {
          return c.json({
            error: "amm_request_failed",
            operationId: reservedOperation.id,
          }, 502)
        }
        throw error
      }
    },
  )

  app.get(
    "/v1/amm/operations/:operationId",
    describeMcpRoute({
      "x-mcp": true,
      operationId: "getAmmResearchOperation",
      tags: ["AMM Research"],
      summary: "Get a KDP keyword research operation",
      description: "Reads an organization-owned AMM operation, returning its public result and reconciling terminal usage once.",
      responses: operationResponses("The AMM research operation was returned."),
    }),
    orgMemberRouteMiddleware,
    paramValidator(ammRouteOperationParamsSchema),
    async (c) => {
      const entitlement = entitlementFor(c)
      if (!entitlement.ok) return c.json(entitlement.response, entitlement.status)
      const organizationId = c.get("organizationContext").organization.id
      const { operationId } = c.req.valid("param")
      try {
        const operation = await service.getOwnedAmmOperation({ organizationId, operationId })
        if (!operation) return c.json({ error: "amm_operation_not_found" }, 404)
        if (operation.state === "cancelled" || !operation.ammRunId) {
          return c.json(publicRunResponse({
            operationId: operation.id,
            state: operation.state === "completed" ? "succeeded" : operation.state,
            result: null,
          }))
        }

        const run = validateRunResponse(
          await client.getRun(operation.ammRunId, { requestId: c.get("requestId") }),
        )
        await reconcileTerminalRun({ organizationId, operation, run, service })
        return c.json(publicRunResponse({
          operationId: operation.id,
          state: run.state,
          result: run.result,
          usage: run.usage,
        }))
      } catch (error) {
        const failure = routeFailure(error)
        if (failure) return c.json(failure.body, failure.status)
        throw error
      }
    },
  )

  app.delete(
    "/v1/amm/operations/:operationId",
    describeMcpRoute({
      "x-mcp": true,
      operationId: "cancelAmmResearchOperation",
      tags: ["AMM Research"],
      summary: "Cancel a KDP keyword research operation",
      description: "Cancels an organization-owned AMM research operation without exposing its downstream run identifier.",
      responses: operationResponses("The AMM research operation was cancelled."),
    }),
    orgMemberRouteMiddleware,
    paramValidator(ammRouteOperationParamsSchema),
    async (c) => {
      const entitlement = entitlementFor(c)
      if (!entitlement.ok) return c.json(entitlement.response, entitlement.status)
      const organizationId = c.get("organizationContext").organization.id
      const { operationId } = c.req.valid("param")
      try {
        const prepared = await prepareCancellationAfterStart({
          organizationId,
          operationId,
          service,
          waitMs: startCancellationWaitMs,
        })
        if (!prepared) return c.json({ error: "amm_operation_not_found" }, 404)
        if (prepared.kind === "start_pending") {
          return c.json({
            error: "amm_operation_state_conflict",
            operationId: prepared.operation.id,
          }, 409)
        }
        if (prepared.kind === "cancelled") {
          return c.json(publicRunResponse({
            operationId: prepared.operation.id,
            state: "cancelled",
            result: null,
          }))
        }
        const ammRunId = prepared.operation.ammRunId
        if (!ammRunId) throw new AmmServiceError("amm_operation_state_conflict")
        const run = await client.cancelRun(ammRunId, { requestId: c.get("requestId") })
        const cancelled = await service.cancelOwnedAmmOperation({ organizationId, operationId })
        if (!cancelled) return c.json({ error: "amm_operation_not_found" }, 404)
        return c.json(publicRunResponse({
          operationId: cancelled.id,
          state: run.state,
          result: null,
        }))
      } catch (error) {
        const failure = routeFailure(error)
        if (failure) return c.json(failure.body, failure.status)
        throw error
      }
    },
  )

  app.get(
    "/v1/amm/kdp/keyword-observations",
    describeMcpRoute({
      "x-mcp": true,
      operationId: "getAmmKdpKeywordObservations",
      tags: ["AMM Research"],
      summary: "Get KDP keyword research observations",
      description: "Returns reusable KDP keyword observations with customer and downstream-run linkage removed.",
      responses: {
        200: jsonResponse("Identity-free KDP keyword observations were returned.", ammKeywordObservationResponseSchema),
        400: jsonResponse("The query was invalid.", invalidRequestSchema),
        401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
        402: jsonResponse("AMM research access is required.", ammResearchNotEnabledSchema),
        429: jsonResponse("The downstream service is rate limited.", ammRouteErrorSchema),
        502: jsonResponse("The AMM service rejected the request or returned an invalid response.", ammRouteErrorSchema),
        503: jsonResponse("The AMM service is not configured.", ammRouteErrorSchema),
        504: jsonResponse("The AMM service timed out.", ammRouteErrorSchema),
      },
    }),
    orgMemberRouteMiddleware,
    queryValidator(ammKeywordObservationQuerySchema),
    async (c) => {
      const entitlement = entitlementFor(c)
      if (!entitlement.ok) return c.json(entitlement.response, entitlement.status)
      try {
        const response = await client.getKeywordObservations(c.req.valid("query"), {
          requestId: c.get("requestId"),
        })
        return c.json(ammKeywordObservationResponseSchema.parse(stripPrivateFields(response)))
      } catch (error) {
        const failure = routeFailure(error)
        if (failure) return c.json(failure.body, failure.status)
        throw error
      }
    },
  )

  app.post(
    "/v1/amm/kdp/keyword-scores",
    describeMcpRoute({
      "x-mcp": true,
      operationId: "scoreAmmKdpKeywords",
      tags: ["AMM Research"],
      summary: "Score KDP keyword research candidates",
      description: "Synchronously returns a deterministic ranking for bounded KDP keyword candidates. This operation does not create an asynchronous run.",
      responses: {
        200: jsonResponse("The deterministic KDP keyword ranking was returned.", ammKeywordScoreResponseSchema),
        400: jsonResponse("The scoring request was invalid.", invalidRequestSchema),
        401: jsonResponse("The caller must be signed in.", unauthorizedSchema),
        402: jsonResponse("AMM research access is required.", ammResearchNotEnabledSchema),
        429: jsonResponse("The downstream service is rate limited.", ammRouteErrorSchema),
        502: jsonResponse("The AMM service rejected the request or returned an invalid response.", ammRouteErrorSchema),
        503: jsonResponse("The AMM service is not configured.", ammRouteErrorSchema),
        504: jsonResponse("The AMM service timed out.", ammRouteErrorSchema),
      },
    }),
    orgMemberRouteMiddleware,
    jsonValidator(scoreAmmKdpKeywordsSchema),
    async (c) => {
      const entitlement = entitlementFor(c)
      if (!entitlement.ok) return c.json(entitlement.response, entitlement.status)
      try {
        const input = c.req.valid("json")
        const response = await client.scoreKeywords(
          input,
          { requestId: c.get("requestId") },
        )
        return c.json(verifiedKeywordScoreResponse(input, response))
      } catch (error) {
        const failure = routeFailure(error)
        if (failure) return c.json(failure.body, failure.status)
        throw error
      }
    },
  )
}
