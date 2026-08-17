import { createDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"

export const DEMO_AMM_USAGE_LIMIT_UNITS = 100
const DEMO_AMM_USAGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export type DemoAmmUsageBucket = {
  id: DenTypeId<"ammUsageBucket">
  limitUnits: number
  organizationId: DenTypeId<"organization">
  windowEndAt: Date
  windowStartAt: Date
}

export type DemoAmmSeedTransaction = {
  deleteAmmOperations(organizationId: DenTypeId<"organization">): Promise<void>
  deleteAmmUsageBuckets(organizationId: DenTypeId<"organization">): Promise<void>
  deleteAmmUsageLedgerEntries(organizationId: DenTypeId<"organization">): Promise<void>
  insertAmmUsageBucket(bucket: DemoAmmUsageBucket): Promise<void>
  listAmmUsageBuckets(organizationId: DenTypeId<"organization">): Promise<DemoAmmUsageBucket[]>
  lockOrganization(organizationId: DenTypeId<"organization">): Promise<void>
}

export type DemoAmmSeedStore = {
  transaction<T>(run: (transaction: DemoAmmSeedTransaction) => Promise<T>): Promise<T>
}

export class DemoAmmSeedResetRequiredError extends Error {
  constructor(organizationId: DenTypeId<"organization">) {
    super(`Demo AMM bucket state for ${organizationId} requires --reset before reseeding.`)
    this.name = "DemoAmmSeedResetRequiredError"
  }
}

export function createDemoOrganizationMetadata(updatedAt: Date) {
  return {
    demoSeed: {
      source: "den-api seed:demo-org",
      updatedAt: updatedAt.toISOString(),
    },
    features: {
      ammResearch: true,
    },
    limits: {
      members: 100,
      workers: 0,
    },
  }
}

export async function ensureDemoAmmUsageBucket(input: {
  now: Date
  organizationId: DenTypeId<"organization">
  store: DemoAmmSeedStore
}) {
  return input.store.transaction(async (transaction) => {
    await transaction.lockOrganization(input.organizationId)
    const existingBuckets = await transaction.listAmmUsageBuckets(input.organizationId)
    const currentBuckets = existingBuckets.filter((bucket) => (
      bucket.windowStartAt <= input.now && bucket.windowEndAt > input.now
    ))

    if (
      existingBuckets.length === 1
      && currentBuckets.length === 1
      && currentBuckets[0]?.limitUnits === DEMO_AMM_USAGE_LIMIT_UNITS
    ) {
      return currentBuckets[0]
    }

    if (existingBuckets.length > 0) {
      throw new DemoAmmSeedResetRequiredError(input.organizationId)
    }

    const bucket: DemoAmmUsageBucket = {
      id: createDenTypeId("ammUsageBucket"),
      limitUnits: DEMO_AMM_USAGE_LIMIT_UNITS,
      organizationId: input.organizationId,
      windowEndAt: new Date(input.now.getTime() + DEMO_AMM_USAGE_WINDOW_MS),
      windowStartAt: input.now,
    }
    await transaction.insertAmmUsageBucket(bucket)
    return bucket
  })
}

export async function clearDemoAmmData(input: {
  organizationId: DenTypeId<"organization">
  store: DemoAmmSeedStore
}) {
  await input.store.transaction(async (transaction) => {
    await transaction.lockOrganization(input.organizationId)
    await transaction.deleteAmmUsageLedgerEntries(input.organizationId)
    await transaction.deleteAmmOperations(input.organizationId)
    await transaction.deleteAmmUsageBuckets(input.organizationId)
  })
}
