import { createDenDb } from "@openwork-ee/den-db"
import {
  AmmOperationTable,
  AmmUsageBucketTable,
  AmmUsageLedgerEntryTable,
} from "@openwork-ee/den-db/schema"
import { eq, inArray } from "@openwork-ee/den-db/drizzle"
import { createDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"
import { describe, expect, it } from "bun:test"
import type {
  AmmOperation,
  AmmOperationUpdate,
  AmmStore,
  AmmStoreTransaction,
  AmmUsageBucket,
  AmmUsageBucketUpdate,
  AmmUsageLedgerEntry,
} from "./service.js"

process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_test"
process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:8790"

const { AmmServiceError, DrizzleAmmStore, createAmmService } = await import("./service.js")

const now = new Date("2026-08-17T12:00:00.000Z")
const windowStart = new Date("2026-08-17T00:00:00.000Z")
const windowEnd = new Date("2026-08-18T00:00:00.000Z")
const organizationA = createDenTypeId("organization")
const organizationB = createDenTypeId("organization")
const memberA = createDenTypeId("member")

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

  seedBucket(input: {
    limitUnits: number
    organizationId?: DenTypeId<"organization">
    reservedUnits?: number
    usedUnits?: number
  }) {
    const bucket: AmmUsageBucket = {
      id: createDenTypeId("ammUsageBucket"),
      organizationId: input.organizationId ?? organizationA,
      limitUnits: input.limitUnits,
      reservedUnits: input.reservedUnits ?? 0,
      usedUnits: input.usedUnits ?? 0,
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
    const duplicate = [...this.operations.values()].some(
      (candidate) => candidate.organizationId === operation.organizationId
        && candidate.operationKey === operation.operationKey,
    )
    if (duplicate) throw new Error("duplicate AMM operation")
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

function serviceWithBucket(limitUnits = 20) {
  const store = new MemoryAmmStore()
  const bucket = store.seedBucket({ limitUnits })
  return { bucket, service: createAmmService(store, () => now), store }
}

function reservation(overrides: Partial<Parameters<ReturnType<typeof createAmmService>["reserveAmmOperation"]>[0]> = {}) {
  return {
    organizationId: organizationA,
    orgMembershipId: memberA,
    operationKey: "kdp-live-001",
    capability: "kdp.keyword-collection",
    requestDigest: "sha256:request-a",
    maximumUnits: 4,
    ...overrides,
  }
}

async function captureAmmError(run: Promise<unknown> | (() => Promise<unknown>)) {
  try {
    await (typeof run === "function" ? run() : run)
  } catch (error) {
    expect(error).toBeInstanceOf(AmmServiceError)
    if (!(error instanceof AmmServiceError)) throw error
    return error
  }
  throw new Error("Expected an AMM service error")
}

describe("AMM operation ownership and usage", () => {
  it("returns the same operation for the same organization, operation key, and digest", async () => {
    const { bucket, service, store } = serviceWithBucket()

    const first = await service.reserveAmmOperation(reservation())
    const second = await service.reserveAmmOperation(reservation())

    expect(second).toEqual(first)
    expect(store.operations.size).toBe(1)
    expect(store.buckets.get(bucket.id)?.reservedUnits).toBe(4)
  })

  it("returns a conflict for the same key with a different digest", async () => {
    const { bucket, service, store } = serviceWithBucket()
    await service.reserveAmmOperation(reservation())

    const error = await captureAmmError(service.reserveAmmOperation(reservation({
      requestDigest: "sha256:request-b",
    })))

    expect(error.code).toBe("amm_operation_conflict")
    expect(store.operations.size).toBe(1)
    expect(store.buckets.get(bucket.id)?.reservedUnits).toBe(4)
  })

  it("does not expose an operation to another organization", async () => {
    const { service } = serviceWithBucket()
    const operation = await service.reserveAmmOperation(reservation())

    const visible = await service.getOwnedAmmOperation({
      organizationId: organizationB,
      operationId: operation.id,
    })

    expect(visible).toBe(null)
  })

  it("atomically rejects a reservation beyond the remaining bucket", async () => {
    const { bucket, service, store } = serviceWithBucket(5)

    const results = await Promise.allSettled([
      service.reserveAmmOperation(reservation({ operationKey: "concurrent-a" })),
      service.reserveAmmOperation(reservation({ operationKey: "concurrent-b" })),
    ])

    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const rejected = results.filter((result) => result.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const reason = rejected[0]?.status === "rejected" ? rejected[0].reason : null
    expect(reason).toBeInstanceOf(AmmServiceError)
    if (!(reason instanceof AmmServiceError)) throw new Error("Expected quota error")
    expect(reason.code).toBe("amm_quota_exceeded")
    expect(store.operations.size).toBe(1)
    expect(store.buckets.get(bucket.id)?.reservedUnits).toBe(4)
  })

  it("reconciliation is idempotent and never charges more than reserved units", async () => {
    const { bucket, service, store } = serviceWithBucket()
    const operation = await service.reserveAmmOperation(reservation({ maximumUnits: 5 }))
    await service.attachAmmRun({
      organizationId: organizationA,
      operationId: operation.id,
      ammRunId: "run_live_001",
    })

    const first = await service.reconcileAmmOperation({
      organizationId: organizationA,
      operationId: operation.id,
      actualUnits: 9,
      providerCalls: 12,
      upstreamCostUsd: "1.75",
    })
    const second = await service.reconcileAmmOperation({
      organizationId: organizationA,
      operationId: operation.id,
      actualUnits: 9,
      providerCalls: 12,
      upstreamCostUsd: "1.75",
    })

    expect(second).toEqual(first)
    expect(first?.state).toBe("completed")
    expect(first?.actualUnits).toBe(5)
    expect(store.ledgerEntries.size).toBe(1)
    expect([...store.ledgerEntries.values()][0]?.quantityUnits).toBe(5)
    expect(store.buckets.get(bucket.id)?.reservedUnits).toBe(0)
    expect(store.buckets.get(bucket.id)?.usedUnits).toBe(5)
  })

  it("records provider calls and upstream USD separately from customer capability units", async () => {
    const { bucket, service, store } = serviceWithBucket()
    const operation = await service.reserveAmmOperation(reservation({ maximumUnits: 10 }))

    await service.reconcileAmmOperation({
      organizationId: organizationA,
      operationId: operation.id,
      actualUnits: 3,
      providerCalls: 17,
      upstreamCostUsd: "4.50",
    })

    const ledger = [...store.ledgerEntries.values()][0]
    expect(ledger?.capability).toBe("kdp.keyword-collection")
    expect(ledger?.quantityUnits).toBe(3)
    expect(ledger?.providerCalls).toBe(17)
    expect(ledger?.upstreamCostUsd).toBe("4.50")
    expect(store.buckets.get(bucket.id)?.usedUnits).toBe(3)
  })

  it("rejects provider-call counts that do not fit the usage ledger column", async () => {
    const { service } = serviceWithBucket()
    const operation = await service.reserveAmmOperation(reservation())

    const error = await captureAmmError(() => service.reconcileAmmOperation({
      organizationId: organizationA,
      operationId: operation.id,
      actualUnits: 1,
      providerCalls: 2_147_483_648,
      upstreamCostUsd: "1.00",
    }))

    expect(error.code).toBe("amm_invalid_usage")
  })

  it("attaches and cancels only an owned operation while releasing its reservation", async () => {
    const { bucket, service, store } = serviceWithBucket()
    const operation = await service.reserveAmmOperation(reservation({ maximumUnits: 6 }))

    expect(await service.attachAmmRun({
      organizationId: organizationB,
      operationId: operation.id,
      ammRunId: "run_hidden",
    })).toBe(null)
    const attached = await service.attachAmmRun({
      organizationId: organizationA,
      operationId: operation.id,
      ammRunId: "run_owned",
    })
    expect(attached?.ammRunId).toBe("run_owned")

    expect(await service.cancelOwnedAmmOperation({
      organizationId: organizationB,
      operationId: operation.id,
    })).toBe(null)
    const cancelled = await service.cancelOwnedAmmOperation({
      organizationId: organizationA,
      operationId: operation.id,
    })

    expect(cancelled?.state).toBe("cancelled")
    expect(store.buckets.get(bucket.id)?.reservedUnits).toBe(0)
  })
})

const mysqlIntegrationDatabaseUrl = process.env.AMM_MYSQL_INTEGRATION_DATABASE_URL?.trim()

if (mysqlIntegrationDatabaseUrl) {
  it("serializes reservation and reconciliation races with MySQL row locks", async () => {
    const database = createDenDb({
      databaseUrl: mysqlIntegrationDatabaseUrl,
      mode: "mysql",
    })
    const mysqlService = createAmmService(new DrizzleAmmStore(database.db), () => now)
    const quotaOrganizationId = createDenTypeId("organization")
    const idempotencyOrganizationId = createDenTypeId("organization")
    const reconciliationOrganizationId = createDenTypeId("organization")
    const organizationIds = [
      quotaOrganizationId,
      idempotencyOrganizationId,
      reconciliationOrganizationId,
    ]

    async function clearIntegrationRows() {
      await database.db.delete(AmmUsageLedgerEntryTable).where(
        inArray(AmmUsageLedgerEntryTable.organizationId, organizationIds),
      )
      await database.db.delete(AmmOperationTable).where(
        inArray(AmmOperationTable.organizationId, organizationIds),
      )
      await database.db.delete(AmmUsageBucketTable).where(
        inArray(AmmUsageBucketTable.organizationId, organizationIds),
      )
    }

    async function seedMysqlBucket(
      organizationId: DenTypeId<"organization">,
      limitUnits: number,
    ) {
      const id = createDenTypeId("ammUsageBucket")
      await database.db.insert(AmmUsageBucketTable).values({
        id,
        organizationId,
        limitUnits,
        windowStartAt: windowStart,
        windowEndAt: windowEnd,
      })
      return id
    }

    try {
      await clearIntegrationRows()
      const quotaBucketId = await seedMysqlBucket(quotaOrganizationId, 5)

      const quotaResults = await Promise.allSettled([
        mysqlService.reserveAmmOperation(reservation({
          operationKey: "mysql-quota-a",
          organizationId: quotaOrganizationId,
        })),
        mysqlService.reserveAmmOperation(reservation({
          operationKey: "mysql-quota-b",
          organizationId: quotaOrganizationId,
        })),
      ])

      expect(quotaResults.filter((result) => result.status === "fulfilled")).toHaveLength(1)
      const quotaRejections = quotaResults.filter((result) => result.status === "rejected")
      expect(quotaRejections).toHaveLength(1)
      const quotaReason = quotaRejections[0]?.reason
      expect(quotaReason).toBeInstanceOf(AmmServiceError)
      if (!(quotaReason instanceof AmmServiceError)) throw new Error("Expected MySQL quota error")
      expect(quotaReason.code).toBe("amm_quota_exceeded")
      const quotaBuckets = await database.db.select().from(AmmUsageBucketTable).where(
        eq(AmmUsageBucketTable.id, quotaBucketId),
      )
      expect(quotaBuckets[0]?.reservedUnits).toBe(4)

      const idempotencyBucketId = await seedMysqlBucket(idempotencyOrganizationId, 10)
      const sameReservation = reservation({
        operationKey: "mysql-same-key",
        organizationId: idempotencyOrganizationId,
      })
      const sameKeyOperations = await Promise.all([
        mysqlService.reserveAmmOperation(sameReservation),
        mysqlService.reserveAmmOperation(sameReservation),
      ])
      expect(sameKeyOperations[1]?.id).toBe(sameKeyOperations[0]?.id)
      const idempotencyBuckets = await database.db.select().from(AmmUsageBucketTable).where(
        eq(AmmUsageBucketTable.id, idempotencyBucketId),
      )
      expect(idempotencyBuckets[0]?.reservedUnits).toBe(4)

      const reconciliationBucketId = await seedMysqlBucket(reconciliationOrganizationId, 10)
      const operation = await mysqlService.reserveAmmOperation(reservation({
        maximumUnits: 6,
        operationKey: "mysql-reconcile",
        organizationId: reconciliationOrganizationId,
      }))
      const reconciliation = {
        actualUnits: 4,
        operationId: operation.id,
        organizationId: reconciliationOrganizationId,
        providerCalls: 11,
        upstreamCostUsd: "2.25",
      }
      await Promise.all([
        mysqlService.reconcileAmmOperation(reconciliation),
        mysqlService.reconcileAmmOperation(reconciliation),
      ])

      const reconciliationBuckets = await database.db.select().from(AmmUsageBucketTable).where(
        eq(AmmUsageBucketTable.id, reconciliationBucketId),
      )
      expect(reconciliationBuckets[0]?.reservedUnits).toBe(0)
      expect(reconciliationBuckets[0]?.usedUnits).toBe(4)
      const ledgerEntries = await database.db.select().from(AmmUsageLedgerEntryTable).where(
        eq(AmmUsageLedgerEntryTable.operationId, operation.id),
      )
      expect(ledgerEntries).toHaveLength(1)
    } finally {
      await clearIntegrationRows()
      const client = database.client
      if ("end" in client && typeof client.end === "function") await client.end()
    }
  })
}
