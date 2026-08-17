import { z } from "zod"

const forbiddenIdentityFieldNames = [
  "tenantId",
  "organizationId",
  "memberId",
  "userId",
  "subscriptionId",
  "reservationId",
] as const

const timestampSchema = z.string().datetime({ offset: true })
const marketplaceSchema = z.string().trim().min(1).max(100)
const languageSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)
const departmentSchema = z.enum(["books", "kindle-store"])
const targetFormatSchema = z.enum(["kindle", "paperback", "hardcover"])
const currencySchema = z.string().regex(/^[A-Z]{3}$/)

const publicContextSchema = z.object({
  marketplace: marketplaceSchema,
  language: languageSchema,
  department: departmentSchema,
  targetFormat: targetFormatSchema,
  currency: currencySchema,
}).strict().superRefine((context, issue) => {
  if (context.department === "books" && context.targetFormat === "kindle") {
    issue.addIssue({ code: "custom", path: ["targetFormat"], message: "books cannot use kindle format" })
  }
  if (context.department === "kindle-store" && context.targetFormat !== "kindle") {
    issue.addIssue({ code: "custom", path: ["targetFormat"], message: "kindle-store requires kindle format" })
  }
})

const collectionLimitsSchema = z.object({
  maxUnits: z.number().int().min(1).max(20),
  maxProducts: z.number().int().min(1).max(3),
  maxPages: z.number().int().min(1).max(1),
  searchDepth: z.number().int().min(1).max(3),
}).strict()

export const startAmmKdpKeywordCollectionSchema = z.object({
  operationKey: z.string().trim().min(1).max(128),
  evaluationTargetAsOf: timestampSchema,
  keyword: z.string().trim().min(1).max(500),
  marketplace: marketplaceSchema,
  language: languageSchema,
  department: departmentSchema,
  targetFormat: targetFormatSchema,
  currency: currencySchema,
  collectionIntent: z.enum(["prefer-reuse", "corpus-only", "refresh"]),
  evidenceLevel: z.string().trim().min(1).max(64),
  limits: collectionLimitsSchema,
}).strict().superRefine((input, issue) => {
  if (input.department === "books" && input.targetFormat === "kindle") {
    issue.addIssue({ code: "custom", path: ["targetFormat"], message: "books cannot use kindle format" })
  }
  if (input.department === "kindle-store" && input.targetFormat !== "kindle") {
    issue.addIssue({ code: "custom", path: ["targetFormat"], message: "kindle-store requires kindle format" })
  }
})

const scoreCandidateSchema = z.object({
  candidateId: z.string().trim().min(1).max(128),
  demand: z.number().min(0).max(100),
  competition: z.number().min(0).max(100),
}).strict()

export const scoreAmmKdpKeywordsSchema = z.object({
  schemaVersion: z.literal("amm.kdp.keyword-scores.request/v1"),
  candidates: z.array(scoreCandidateSchema).min(1).max(500),
}).strict()

export const ammOperationParamsSchema = z.object({
  operationId: z.string().trim().min(1).max(128),
}).strict()

export const ammKeywordObservationQuerySchema = z.object({
  keyword: z.string().trim().min(1).max(500),
  marketplace: marketplaceSchema.default("amazon.com"),
  department: departmentSchema.optional(),
  format: targetFormatSchema.optional(),
  freshWithinHours: z.coerce.number().int().min(1).max(24 * 30).default(24),
}).strict()

export const ammProviderUsageSchema = z.object({
  capabilityUnits: z.number().int().min(0),
  providerCalls: z.number().int().min(0).max(2_147_483_647),
  upstreamCostUsd: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/),
}).strict()

export type AmmProviderUsage = z.infer<typeof ammProviderUsageSchema>

const ammRunStateSchema = z.enum(["queued", "running", "succeeded", "partially_succeeded", "failed", "cancelled", "expired"])

export const ammRunAcknowledgementSchema = z.object({
  runId: z.string().trim().min(1).max(128),
  operation: z.string().trim().min(1).max(128),
  state: ammRunStateSchema,
  requestId: z.string().trim().min(1).max(128),
}).strict()

export const ammRunResponseSchema = z.object({
  runId: z.string().trim().min(1).max(128),
  operation: z.string().trim().min(1).max(128),
  state: ammRunStateSchema,
  result: z.unknown().nullable(),
  usage: ammProviderUsageSchema.optional(),
  requestId: z.string().trim().min(1).max(128),
}).strict()

const downstreamCollectionBodySchema = z.object({
  schemaVersion: z.literal("amm.kdp.managed-keyword-collection.request/v1"),
  evaluationTargetAsOf: timestampSchema,
  queries: z.array(z.object({
    candidateId: z.string().trim().min(1).max(128),
    normalizedKeyword: z.string().trim().min(1).max(500),
    context: publicContextSchema,
    requestedMetrics: z.array(z.enum([
      "amazon_monthly_search_volume",
      "amazon_search_result_count",
      "amazon_bsr",
      "amazon_review_count",
      "amazon_rating",
      "amazon_price",
    ])).min(1).max(8),
    search: z.object({
      depth: z.number().int().min(1).max(100),
      includeSponsored: z.boolean(),
    }).strict(),
    enrichment: z.object({
      mode: z.literal("top-n-organic"),
      topN: z.number().int().min(1).max(20),
      productFields: z.array(z.string().trim().min(1)).min(1).max(8),
    }).strict(),
  }).strict()).min(1).max(100),
  collectionIntent: z.enum(["prefer-reuse", "corpus-only", "refresh"]),
  usageLimit: z.object({
    unit: z.literal("amm.capability-units/v1"),
    maxUnits: z.number().int().positive(),
    maxProducts: z.number().int().positive(),
    maxPages: z.number().int().positive(),
  }).strict(),
  evidenceLevel: z.string().trim().min(1).max(64),
}).strict()

export type StartAmmKdpKeywordCollection = z.infer<typeof startAmmKdpKeywordCollectionSchema>

export function toAmmCollectionBody(input: StartAmmKdpKeywordCollection) {
  const publicInput = startAmmKdpKeywordCollectionSchema.parse(input)
  const body = downstreamCollectionBodySchema.parse({
    schemaVersion: "amm.kdp.managed-keyword-collection.request/v1",
    evaluationTargetAsOf: publicInput.evaluationTargetAsOf,
    queries: [{
      candidateId: publicInput.operationKey,
      normalizedKeyword: publicInput.keyword,
      context: {
        marketplace: publicInput.marketplace,
        language: publicInput.language,
        department: publicInput.department,
        targetFormat: publicInput.targetFormat,
        currency: publicInput.currency,
      },
      requestedMetrics: [
        "amazon_monthly_search_volume",
        "amazon_search_result_count",
        "amazon_bsr",
        "amazon_review_count",
        "amazon_rating",
        "amazon_price",
      ],
      search: { depth: publicInput.limits.searchDepth, includeSponsored: false },
      enrichment: { mode: "top-n-organic", topN: publicInput.limits.maxProducts, productFields: ["bsr", "reviewCount", "rating", "price"] },
    }],
    collectionIntent: publicInput.collectionIntent,
    usageLimit: {
      unit: "amm.capability-units/v1",
      maxUnits: publicInput.limits.maxUnits,
      maxProducts: publicInput.limits.maxProducts,
      maxPages: publicInput.limits.maxPages,
    },
    evidenceLevel: publicInput.evidenceLevel,
  })

  if (forbiddenIdentityFieldNames.some((field) => field in body)) {
    throw new Error("AMM collection body must not contain customer identity fields")
  }

  return body
}
