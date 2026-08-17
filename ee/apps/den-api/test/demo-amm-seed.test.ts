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

  async listAmmUsageBuckets(organizationId: DenTypeId<"organization">) {
    return this.bucketsFor(organizationId).map((bucket) => ({ ...bucket }))
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

test("ordinary demo seed returns an existing correct bucket without mutation", async () => {
  const store = new MemoryDemoAmmSeedStore()
  const bucket = store.seedBucket({
    limitUnits: 100,
    organizationId: demoOrganizationId,
    windowEndAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    windowStartAt: now,
  })

  const first = await ensureDemoAmmUsageBucket({ now, organizationId: demoOrganizationId, store })
  const second = await ensureDemoAmmUsageBucket({ now, organizationId: demoOrganizationId, store })

  expect(first).toEqual(bucket)
  expect(second).toEqual(bucket)
  expect(store.bucketsFor(demoOrganizationId)).toEqual([bucket])
  expect(store.events).toEqual([
    `lock:${demoOrganizationId}`,
    `lock:${demoOrganizationId}`,
  ])
})

test("ordinary demo seed creates the canonical bucket only when no AMM bucket exists", async () => {
  const store = new MemoryDemoAmmSeedStore()

  await ensureDemoAmmUsageBucket({ now, organizationId: demoOrganizationId, store })

  expect(store.bucketsFor(demoOrganizationId)).toEqual([
    expect.objectContaining({
      limitUnits: 100,
      organizationId: demoOrganizationId,
      windowEndAt: new Date("2026-09-16T12:00:00.000Z"),
      windowStartAt: now,
    }),
  ])
})

test("ordinary demo seed preserves malformed AMM state and requires reset", async () => {
  const store = new MemoryDemoAmmSeedStore()
  const malformedBucket = store.seedBucket({
    limitUnits: 1,
    organizationId: demoOrganizationId,
    windowEndAt: new Date(now.getTime() + 60_000),
    windowStartAt: new Date(now.getTime() - 60_000),
  })
  const overlappingBucket = store.seedBucket({
    limitUnits: 100,
    organizationId: demoOrganizationId,
    windowEndAt: new Date(now.getTime() + 120_000),
    windowStartAt: new Date(now.getTime() - 120_000),
  })
  store.ledgerOrganizationIds.add(demoOrganizationId)
  store.operationOrganizationIds.add(demoOrganizationId)

  await expect(ensureDemoAmmUsageBucket({ now, organizationId: demoOrganizationId, store }))
    .rejects.toThrow("requires --reset")

  expect(store.bucketsFor(demoOrganizationId)).toEqual([malformedBucket, overlappingBucket])
  expect(store.ledgerOrganizationIds.has(demoOrganizationId)).toBe(true)
  expect(store.operationOrganizationIds.has(demoOrganizationId)).toBe(true)
  expect(store.events).toEqual([`lock:${demoOrganizationId}`])
})

test("ordinary demo seed preserves historical AMM accounting and requires reset", async () => {
  const store = new MemoryDemoAmmSeedStore()
  const historicalBucket = store.seedBucket({
    limitUnits: 100,
    organizationId: demoOrganizationId,
    windowEndAt: new Date(now.getTime() - 1),
    windowStartAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  })
  store.ledgerOrganizationIds.add(demoOrganizationId)
  store.operationOrganizationIds.add(demoOrganizationId)

  await expect(ensureDemoAmmUsageBucket({ now, organizationId: demoOrganizationId, store }))
    .rejects.toThrow("requires --reset")

  expect(store.bucketsFor(demoOrganizationId)).toEqual([historicalBucket])
  expect(store.ledgerOrganizationIds.has(demoOrganizationId)).toBe(true)
  expect(store.operationOrganizationIds.has(demoOrganizationId)).toBe(true)
  expect(store.events).toEqual([`lock:${demoOrganizationId}`])
})

test("ordinary demo seed preserves a future AMM bucket and requires reset", async () => {
  const store = new MemoryDemoAmmSeedStore()
  const futureBucket = store.seedBucket({
    limitUnits: 100,
    organizationId: demoOrganizationId,
    windowEndAt: new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000),
    windowStartAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  })

  await expect(ensureDemoAmmUsageBucket({ now, organizationId: demoOrganizationId, store }))
    .rejects.toThrow("requires --reset")

  expect(store.bucketsFor(demoOrganizationId)).toEqual([futureBucket])
  expect(store.events).toEqual([`lock:${demoOrganizationId}`])
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
  expect(store.events.filter((event) => event === `insert:${demoOrganizationId}`)).toHaveLength(1)
  expect(store.events.filter((event) => event === `buckets:${demoOrganizationId}`)).toHaveLength(0)
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
