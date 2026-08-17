import { expect, test } from "bun:test"
import { createDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"
import {
  clearDemoAmmData,
  createDemoOrganizationMetadata,
  ensureDemoAmmUsageBucket,
  type DemoAmmSeedStore,
  type DemoAmmSeedTransaction,
  type DemoAmmUsageBucket,
} from "../src/amm/demo-seed.js"

const now = new Date("2026-08-17T12:00:00.000Z")
const demoOrganizationId = createDenTypeId("organization")
const otherOrganizationId = createDenTypeId("organization")

class MemoryDemoAmmSeedStore implements DemoAmmSeedStore, DemoAmmSeedTransaction {
  readonly buckets = new Map<DenTypeId<"ammUsageBucket">, DemoAmmUsageBucket>()
  readonly events: string[] = []
  readonly ledgerOrganizationIds = new Set<DenTypeId<"organization">>()
  readonly operationOrganizationIds = new Set<DenTypeId<"organization">>()
  readonly organizationIds = new Set<DenTypeId<"organization">>([demoOrganizationId, otherOrganizationId])
  private transactionTail = Promise.resolve()

  async transaction<T>(run: (transaction: DemoAmmSeedTransaction) => Promise<T>): Promise<T> {
    let releaseTransaction: () => void = () => undefined
    const previousTransaction = this.transactionTail
    this.transactionTail = new Promise<void>((resolve) => {
      releaseTransaction = resolve
    })
    await previousTransaction
    try {
      return await run(this)
    } finally {
      releaseTransaction()
    }
  }

  async lockOrganization(organizationId: DenTypeId<"organization">) {
    if (!this.organizationIds.has(organizationId)) throw new Error(`Unknown organization ${organizationId}`)
    this.events.push(`lock:${organizationId}`)
  }

  async deleteAmmUsageBuckets(organizationId: DenTypeId<"organization">) {
    this.events.push(`buckets:${organizationId}`)
    for (const [bucketId, bucket] of this.buckets) {
      if (bucket.organizationId === organizationId) this.buckets.delete(bucketId)
    }
  }

  async insertAmmUsageBucket(bucket: DemoAmmUsageBucket) {
    this.events.push(`insert:${bucket.organizationId}`)
    this.buckets.set(bucket.id, { ...bucket })
  }

  async deleteAmmUsageLedgerEntries(organizationId: DenTypeId<"organization">) {
    this.events.push(`ledger:${organizationId}`)
    this.ledgerOrganizationIds.delete(organizationId)
  }

  async deleteAmmOperations(organizationId: DenTypeId<"organization">) {
    this.events.push(`operations:${organizationId}`)
    this.operationOrganizationIds.delete(organizationId)
  }

  seedBucket(input: Omit<DemoAmmUsageBucket, "id">) {
    const bucket = { id: createDenTypeId("ammUsageBucket"), ...input }
    this.buckets.set(bucket.id, bucket)
    return bucket
  }

  bucketsFor(organizationId: DenTypeId<"organization">) {
    return [...this.buckets.values()].filter((bucket) => bucket.organizationId === organizationId)
  }
}

test("demo seed metadata explicitly grants AMM research", () => {
  expect(createDemoOrganizationMetadata(now)).toEqual({
    demoSeed: {
      source: "den-api seed:demo-org",
      updatedAt: "2026-08-17T12:00:00.000Z",
    },
    features: { ammResearch: true },
    limits: { members: 100, workers: 0 },
  })
})

test("demo seed replaces overlapping current buckets with one finite 100-unit bucket on repeat", async () => {
  const store = new MemoryDemoAmmSeedStore()
  store.seedBucket({
    limitUnits: 1,
    organizationId: demoOrganizationId,
    windowEndAt: new Date(now.getTime() + 60_000),
    windowStartAt: new Date(now.getTime() - 60_000),
  })
  store.seedBucket({
    limitUnits: 999,
    organizationId: demoOrganizationId,
    windowEndAt: new Date(now.getTime() + 120_000),
    windowStartAt: new Date(now.getTime() - 120_000),
  })
  store.seedBucket({
    limitUnits: 77,
    organizationId: otherOrganizationId,
    windowEndAt: new Date(now.getTime() + 60_000),
    windowStartAt: new Date(now.getTime() - 60_000),
  })

  await ensureDemoAmmUsageBucket({ now, organizationId: demoOrganizationId, store })
  await ensureDemoAmmUsageBucket({ now, organizationId: demoOrganizationId, store })

  expect(store.bucketsFor(demoOrganizationId)).toEqual([
    expect.objectContaining({
      limitUnits: 100,
      organizationId: demoOrganizationId,
      windowEndAt: new Date("2026-09-16T12:00:00.000Z"),
      windowStartAt: now,
    }),
  ])
  expect(store.bucketsFor(otherOrganizationId)).toHaveLength(1)
})

test("concurrent demo seeds leave exactly one current AMM bucket", async () => {
  const store = new MemoryDemoAmmSeedStore()

  await Promise.all(Array.from({ length: 8 }, () => ensureDemoAmmUsageBucket({
    now,
    organizationId: demoOrganizationId,
    store,
  })))

  expect(store.bucketsFor(demoOrganizationId)).toEqual([
    expect.objectContaining({
      limitUnits: 100,
      windowEndAt: new Date("2026-09-16T12:00:00.000Z"),
      windowStartAt: now,
    }),
  ])
  expect(store.events.filter((event) => event === `lock:${demoOrganizationId}`)).toHaveLength(8)
})

test("demo reset cleanup removes AMM rows in dependency order", async () => {
  const store = new MemoryDemoAmmSeedStore()
  store.ledgerOrganizationIds.add(demoOrganizationId)
  store.operationOrganizationIds.add(demoOrganizationId)
  store.seedBucket({
    limitUnits: 100,
    organizationId: demoOrganizationId,
    windowEndAt: new Date(now.getTime() + 60_000),
    windowStartAt: new Date(now.getTime() - 60_000),
  })

  await clearDemoAmmData({ organizationId: demoOrganizationId, store })

  expect(store.ledgerOrganizationIds.has(demoOrganizationId)).toBe(false)
  expect(store.operationOrganizationIds.has(demoOrganizationId)).toBe(false)
  expect(store.bucketsFor(demoOrganizationId)).toHaveLength(0)
  expect(store.events).toEqual([
    `lock:${demoOrganizationId}`,
    `ledger:${demoOrganizationId}`,
    `operations:${demoOrganizationId}`,
    `buckets:${demoOrganizationId}`,
  ])
})
