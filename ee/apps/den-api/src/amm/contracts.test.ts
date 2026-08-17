import { describe, expect, it } from "bun:test"
import {
  ammKdpKeywordCollectionResultSchema,
  ammProviderUsageSchema,
  ammRunCancellationAcknowledgementSchema,
  ammRunAcknowledgementSchema,
  parseAmmRunResponse,
  scoreAmmKdpKeywordsSchema,
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
const validCollectionResult = {
  schemaVersion: "amm.kdp.managed-keyword-collection.result/v1",
  runId: "run_test",
  completeness: "partial",
  warnings: [{ provider: "DataForSEO", message: "search-volume cache reused" }],
  candidates: [{
    candidateId: "kdp-live-2026-08-17-001",
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

  it("accepts the strict live start acknowledgement without a result", () => {
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

  it("accepts only cancelled strict cancellation acknowledgements", () => {
    const acknowledgement = {
      runId: "0198b5f0-7b80-7000-8000-000000000001",
      operation: "kdp.keyword-collection",
      state: "cancelled",
      requestId: "req_contract_test",
    }

    expect(ammRunCancellationAcknowledgementSchema.parse(acknowledgement)).toEqual(acknowledgement)
    expect(ammRunCancellationAcknowledgementSchema.safeParse({ ...acknowledgement, state: "running" }).success).toBe(false)
    expect(ammRunCancellationAcknowledgementSchema.safeParse({ ...acknowledgement, state: "succeeded" }).success).toBe(false)
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

  it("rejects duplicate scoring candidate IDs", () => {
    expect(scoreAmmKdpKeywordsSchema.safeParse({
      schemaVersion: "amm.kdp.keyword-scores.request/v1",
      candidates: [
        { candidateId: "duplicate", demand: 70, competition: 20 },
        { candidateId: "duplicate", demand: 60, competition: 10 },
      ],
    }).success).toBe(false)
  })

  it("accepts the strict managed KDP collection result returned to Den", () => {
    expect(ammKdpKeywordCollectionResultSchema.parse(validCollectionResult)).toEqual(validCollectionResult)
  })

  it.each(["queued", "running"] as const)("rejects a nonterminal KDP %s response with a non-null result", (state) => {
    const parsed = parseAmmRunResponse({
      runId: "run_test",
      operation: "kdp.keyword-collection",
      state,
      result: validCollectionResult,
      requestId: "req_contract_test",
    })

    expect(parsed.success).toBe(false)
  })

  it("rejects a terminal KDP response whose embedded result runId mismatches the envelope runId", () => {
    const parsed = parseAmmRunResponse({
      runId: "run_test",
      operation: "kdp.keyword-collection",
      state: "succeeded",
      result: {
        ...validCollectionResult,
        runId: "run_other",
        completeness: "complete",
      },
      usage: { capabilityUnits: 7, providerCalls: 3, upstreamCostUsd: "1.25" },
      requestId: "req_contract_test",
    })

    expect(parsed.success).toBe(false)
  })

  it("rejects KDP collection results that expose signed or identity-bearing URL fields", () => {
    expect(ammKdpKeywordCollectionResultSchema.safeParse({
      ...validCollectionResult,
      candidates: [{
        ...validCollectionResult.candidates[0],
        products: [{
          ...validCollectionResult.candidates[0].products[0],
          detailPageUrl: "https://example.invalid/product?X-Amz-Signature=secret",
        }],
      }],
    }).success).toBe(false)
    expect(ammKdpKeywordCollectionResultSchema.safeParse({
      ...validCollectionResult,
      tenantId: "tenant-private",
    }).success).toBe(false)
  })
})
