import { describe, expect, it } from "bun:test"
import {
  ammProviderUsageSchema,
  ammRunAcknowledgementSchema,
  startAmmKdpKeywordCollectionSchema,
  toAmmCollectionBody,
  type StartAmmKdpKeywordCollection,
} from "./contracts.js"

const liveRequest: StartAmmKdpKeywordCollection = {
  operationKey: "kdp-live-2026-08-17-001",
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
}

const prohibitedIdentityFields = ["tenantId", "organizationId", "memberId", "userId", "subscriptionId", "reservationId"]

function expectNoProhibitedIdentityFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) expectNoProhibitedIdentityFields(item)
    return
  }
  if (!value || typeof value !== "object") return

  for (const [key, item] of Object.entries(value)) {
    expect(prohibitedIdentityFields).not.toContain(key)
    expectNoProhibitedIdentityFields(item)
  }
}

describe("AMM Den contracts", () => {
  it("accepts the hard-capped live request", () => {
    expect(startAmmKdpKeywordCollectionSchema.parse(liveRequest)).toBeTruthy()
  })

  it.each(prohibitedIdentityFields)("rejects the public %s identity field", (field) => {
    const result = startAmmKdpKeywordCollectionSchema.safeParse({
      ...liveRequest,
      [field]: "forbidden",
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error(`Expected ${field} to be rejected`)
    expect(result.error.issues.some((issue) => issue.code === "unrecognized_keys" && issue.keys.includes(field))).toBe(true)
  })

  it("maps the capped collection request to the exact AMM body without identity fields", () => {
    const body = toAmmCollectionBody(liveRequest)

    expect(body).toEqual({
      schemaVersion: "amm.kdp.managed-keyword-collection.request/v1",
      evaluationTargetAsOf: "2026-08-17T00:00:00.000Z",
      queries: [{
        candidateId: "kdp-live-2026-08-17-001",
        normalizedKeyword: "fantasy romance",
        context: {
          marketplace: "amazon.com",
          language: "en",
          department: "books",
          targetFormat: "paperback",
          currency: "USD",
        },
        requestedMetrics: [
          "amazon_monthly_search_volume",
          "amazon_search_result_count",
          "amazon_bsr",
          "amazon_review_count",
          "amazon_rating",
          "amazon_price",
        ],
        search: { depth: 3, includeSponsored: false },
        enrichment: { mode: "top-n-organic", topN: 3, productFields: ["bsr", "reviewCount", "rating", "price"] },
      }],
      collectionIntent: "refresh",
      usageLimit: {
        unit: "amm.capability-units/v1",
        maxUnits: 20,
        maxProducts: 3,
        maxPages: 1,
      },
      evidenceLevel: "standard",
    })
    expectNoProhibitedIdentityFields(body)
  })

  it("accepts the strict live start/cancel acknowledgement without a result", () => {
    expect(ammRunAcknowledgementSchema.parse({
      runId: "0198b5f0-7b80-7000-8000-000000000001",
      operation: "kdp.keyword-collection",
      state: "queued",
      requestId: "req_contract_test",
    })).toEqual({
      runId: "0198b5f0-7b80-7000-8000-000000000001",
      operation: "kdp.keyword-collection",
      state: "queued",
      requestId: "req_contract_test",
    })
  })

  it.each(prohibitedIdentityFields)("rejects the acknowledgement %s identity field", (field) => {
    const result = ammRunAcknowledgementSchema.safeParse({
      runId: "0198b5f0-7b80-7000-8000-000000000001",
      operation: "kdp.keyword-collection",
      state: "queued",
      requestId: "req_contract_test",
      [field]: "forbidden",
    })
    expect(result.success).toBe(false)
  })

  it("rejects provider usage values that the Den accounting store cannot represent", () => {
    expect(ammProviderUsageSchema.safeParse({
      capabilityUnits: 1,
      providerCalls: 2_147_483_648,
      upstreamCostUsd: "0",
    }).success).toBe(false)
    expect(ammProviderUsageSchema.safeParse({
      capabilityUnits: 1,
      providerCalls: 1,
      upstreamCostUsd: "1000000000000.00",
    }).success).toBe(false)
    expect(ammProviderUsageSchema.safeParse({
      capabilityUnits: 1,
      providerCalls: 1,
      upstreamCostUsd: "1.123456789",
    }).success).toBe(false)
  })
})
