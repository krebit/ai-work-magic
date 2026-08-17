import { describe, expect, it } from "vitest"
import { startAmmKdpKeywordCollectionSchema } from "./contracts.js"

describe("AMM Den contracts", () => {
  it("accepts the hard-capped live request", () => {
    expect(startAmmKdpKeywordCollectionSchema.parse({
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
    })).toBeTruthy()
  })

  it("rejects customer identity fields", () => {
    const result = startAmmKdpKeywordCollectionSchema.safeParse({
      operationKey: "kdp-live-2026-08-17-002",
      keyword: "fantasy romance",
      organizationId: "org_forbidden",
    })
    expect(result.success).toBe(false)
  })
})
