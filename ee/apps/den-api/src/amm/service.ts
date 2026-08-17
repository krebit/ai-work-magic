import {
  AmmOperationTable,
  AmmUsageBucketTable,
  AmmUsageLedgerEntryTable,
} from "@openwork-ee/den-db/schema"
import { and, desc, eq, gt, lte } from "@openwork-ee/den-db/drizzle"
import { createDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../db.js"

export type AmmOperation = typeof AmmOperationTable.$inferSelect
export type AmmUsageBucket = typeof AmmUsageBucketTable.$inferSelect
export type AmmUsageLedgerEntry = typeof AmmUsageLedgerEntryTable.$inferSelect

export type AmmOperationUpdate = Partial<Pick<
  AmmOperation,
  | "actualUnits"
  | "ammRunId"
  | "completedAt"
  | "providerCalls"
  | "state"
  | "updatedAt"
  | "upstreamCostUsd"
>>

export type AmmUsageBucketUpdate = Pick<
  AmmUsageBucket,
  "reservedUnits" | "updatedAt" | "usedUnits"
>

export interface AmmStoreTransaction {
  findActiveBucketForUpdate(
    organizationId: DenTypeId<"organization">,
    at: Date,
  ): Promise<AmmUsageBucket | null>
  findOperationBucketForUpdate(operation: AmmOperation): Promise<AmmUsageBucket | null>
  findOperationByKey(
    organizationId: DenTypeId<"organization">,
    operationKey: string,
  ): Promise<AmmOperation | null>
  findOperationByKeyForUpdate(
    organizationId: DenTypeId<"organization">,
    operationKey: string,
  ): Promise<AmmOperation | null>
  findOwnedOperationForUpdate(
    organizationId: DenTypeId<"organization">,
    operationId: DenTypeId<"ammOperation">,
  ): Promise<AmmOperation | null>
  insertLedgerEntry(entry: AmmUsageLedgerEntry): Promise<void>
  insertOperation(operation: AmmOperation): Promise<void>
  updateBucket(
    bucketId: DenTypeId<"ammUsageBucket">,
    update: AmmUsageBucketUpdate,
  ): Promise<void>
  updateOperation(
    operationId: DenTypeId<"ammOperation">,
    update: AmmOperationUpdate,
  ): Promise<void>
}

export interface AmmStore {
  findOwnedOperation(
    organizationId: DenTypeId<"organization">,
    operationId: DenTypeId<"ammOperation">,
  ): Promise<AmmOperation | null>
  transaction<T>(run: (transaction: AmmStoreTransaction) => Promise<T>): Promise<T>
}

export type AmmServiceErrorCode =
  | "amm_invalid_usage"
  | "amm_operation_conflict"
  | "amm_operation_state_conflict"
  | "amm_quota_exceeded"
  | "amm_usage_bucket_not_found"
  | "amm_usage_invariant_violation"

export class AmmServiceError extends Error {
  readonly code: AmmServiceErrorCode

  constructor(code: AmmServiceErrorCode) {
    super(code)
    this.name = "AmmServiceError"
    this.code = code
  }
}

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

class DrizzleAmmTransaction implements AmmStoreTransaction {
  constructor(private readonly transaction: DrizzleTransaction) {}

  async findOperationByKey(
    organizationId: DenTypeId<"organization">,
    operationKey: string,
  ) {
    const rows = await this.transaction
      .select()
      .from(AmmOperationTable)
      .where(and(
        eq(AmmOperationTable.organizationId, organizationId),
        eq(AmmOperationTable.operationKey, operationKey),
      ))
      .limit(1)
    return rows[0] ?? null
  }

  async findOperationByKeyForUpdate(
    organizationId: DenTypeId<"organization">,
    operationKey: string,
  ) {
    const rows = await this.transaction
      .select()
      .from(AmmOperationTable)
      .where(and(
        eq(AmmOperationTable.organizationId, organizationId),
        eq(AmmOperationTable.operationKey, operationKey),
      ))
      .limit(1)
      .for("update")
    return rows[0] ?? null
  }

  async findOwnedOperationForUpdate(
    organizationId: DenTypeId<"organization">,
    operationId: DenTypeId<"ammOperation">,
  ) {
    const rows = await this.transaction
      .select()
      .from(AmmOperationTable)
      .where(and(
        eq(AmmOperationTable.organizationId, organizationId),
        eq(AmmOperationTable.id, operationId),
      ))
      .limit(1)
      .for("update")
    return rows[0] ?? null
  }

  async findActiveBucketForUpdate(
    organizationId: DenTypeId<"organization">,
    at: Date,
  ) {
    const rows = await this.transaction
      .select()
      .from(AmmUsageBucketTable)
      .where(and(
        eq(AmmUsageBucketTable.organizationId, organizationId),
        lte(AmmUsageBucketTable.windowStartAt, at),
        gt(AmmUsageBucketTable.windowEndAt, at),
      ))
      .orderBy(desc(AmmUsageBucketTable.windowStartAt))
      .limit(1)
      .for("update")
    return rows[0] ?? null
  }

  async findOperationBucketForUpdate(operation: AmmOperation) {
    const rows = await this.transaction
      .select()
      .from(AmmUsageBucketTable)
      .where(and(
        eq(AmmUsageBucketTable.organizationId, operation.organizationId),
        lte(AmmUsageBucketTable.windowStartAt, operation.createdAt),
        gt(AmmUsageBucketTable.windowEndAt, operation.createdAt),
      ))
      .orderBy(desc(AmmUsageBucketTable.windowStartAt))
      .limit(1)
      .for("update")
    return rows[0] ?? null
  }

  async insertOperation(operation: AmmOperation) {
    await this.transaction.insert(AmmOperationTable).values(operation)
  }

  async updateOperation(
    operationId: DenTypeId<"ammOperation">,
    update: AmmOperationUpdate,
  ) {
    await this.transaction
      .update(AmmOperationTable)
      .set(update)
      .where(eq(AmmOperationTable.id, operationId))
  }

  async updateBucket(
    bucketId: DenTypeId<"ammUsageBucket">,
    update: AmmUsageBucketUpdate,
  ) {
    await this.transaction
      .update(AmmUsageBucketTable)
      .set(update)
      .where(eq(AmmUsageBucketTable.id, bucketId))
  }

  async insertLedgerEntry(entry: AmmUsageLedgerEntry) {
    await this.transaction.insert(AmmUsageLedgerEntryTable).values(entry)
  }
}

export class DrizzleAmmStore implements AmmStore {
  constructor(private readonly database: typeof db = db) {}

  async findOwnedOperation(
    organizationId: DenTypeId<"organization">,
    operationId: DenTypeId<"ammOperation">,
  ) {
    const rows = await this.database
      .select()
      .from(AmmOperationTable)
      .where(and(
        eq(AmmOperationTable.organizationId, organizationId),
        eq(AmmOperationTable.id, operationId),
      ))
      .limit(1)
    return rows[0] ?? null
  }

  transaction<T>(run: (transaction: AmmStoreTransaction) => Promise<T>) {
    return this.database.transaction(
      (transaction) => run(new DrizzleAmmTransaction(transaction)),
    )
  }
}

type ReserveAmmOperationInput = {
  capability: string
  maximumUnits: number
  organizationId: DenTypeId<"organization">
  orgMembershipId: DenTypeId<"member">
  operationKey: string
  requestDigest: string
}

type OwnedAmmOperationInput = {
  organizationId: DenTypeId<"organization">
  operationId: DenTypeId<"ammOperation">
}

type AttachAmmRunInput = OwnedAmmOperationInput & {
  ammRunId: string
}

type ReconcileAmmOperationInput = OwnedAmmOperationInput & {
  actualUnits: number
  providerCalls: number
  upstreamCostUsd: string
}

function requirePositiveUnits(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AmmServiceError("amm_invalid_usage")
  }
}

function requireNonnegativeUnits(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AmmServiceError("amm_invalid_usage")
  }
}

function requireProviderCalls(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new AmmServiceError("amm_invalid_usage")
  }
}

function requireUpstreamCostUsd(value: string) {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(value)) {
    throw new AmmServiceError("amm_invalid_usage")
  }
}

function idempotentReservation(existing: AmmOperation, requestDigest: string) {
  if (existing.requestDigest !== requestDigest) {
    throw new AmmServiceError("amm_operation_conflict")
  }
  if (existing.state === "cancelled" || existing.state === "completed") {
    throw new AmmServiceError("amm_operation_state_conflict")
  }
  return existing
}

function requireOperationBucket(bucket: AmmUsageBucket | null) {
  if (!bucket) throw new AmmServiceError("amm_usage_bucket_not_found")
  return bucket
}

function releasedReservationUnits(bucket: AmmUsageBucket, operation: AmmOperation) {
  const reservedUnits = bucket.reservedUnits - operation.reservedUnits
  if (reservedUnits < 0) {
    throw new AmmServiceError("amm_usage_invariant_violation")
  }
  return reservedUnits
}

export function createAmmService(store: AmmStore, clock: () => Date = () => new Date()) {
  async function reserveAmmOperation(input: ReserveAmmOperationInput) {
    requirePositiveUnits(input.maximumUnits)

    return store.transaction(async (transaction) => {
      const existing = await transaction.findOperationByKey(
        input.organizationId,
        input.operationKey,
      )
      if (existing) return idempotentReservation(existing, input.requestDigest)

      const createdAt = clock()
      const bucket = requireOperationBucket(await transaction.findActiveBucketForUpdate(
        input.organizationId,
        createdAt,
      ))

      const concurrentExisting = await transaction.findOperationByKeyForUpdate(
        input.organizationId,
        input.operationKey,
      )
      if (concurrentExisting) {
        return idempotentReservation(concurrentExisting, input.requestDigest)
      }

      const remainingUnits = bucket.limitUnits - bucket.usedUnits - bucket.reservedUnits
      if (input.maximumUnits > remainingUnits) {
        throw new AmmServiceError("amm_quota_exceeded")
      }

      const operation: AmmOperation = {
        id: createDenTypeId("ammOperation"),
        organizationId: input.organizationId,
        orgMembershipId: input.orgMembershipId,
        operationKey: input.operationKey,
        operation: input.capability,
        requestDigest: input.requestDigest,
        ammRunId: null,
        state: "reserved",
        reservedUnits: input.maximumUnits,
        actualUnits: 0,
        providerCalls: 0,
        upstreamCostUsd: "0",
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
      }

      await transaction.updateBucket(bucket.id, {
        reservedUnits: bucket.reservedUnits + input.maximumUnits,
        usedUnits: bucket.usedUnits,
        updatedAt: createdAt,
      })
      await transaction.insertOperation(operation)
      return operation
    })
  }

  function getOwnedAmmOperation(input: OwnedAmmOperationInput) {
    return store.findOwnedOperation(input.organizationId, input.operationId)
  }

  function beginAmmOperationStart(input: OwnedAmmOperationInput) {
    return store.transaction(async (transaction) => {
      const operation = await transaction.findOwnedOperationForUpdate(
        input.organizationId,
        input.operationId,
      )
      if (!operation) return null
      if (operation.state === "cancelled" || operation.state === "completed") {
        throw new AmmServiceError("amm_operation_state_conflict")
      }
      if (operation.state === "running") return operation

      const updatedAt = clock()
      await transaction.updateOperation(operation.id, {
        state: "running",
        updatedAt,
      })
      return { ...operation, state: "running" as const, updatedAt }
    })
  }

  function attachAmmRun(input: AttachAmmRunInput) {
    return store.transaction(async (transaction) => {
      const operation = await transaction.findOwnedOperationForUpdate(
        input.organizationId,
        input.operationId,
      )
      if (!operation) return null
      if (operation.ammRunId === input.ammRunId) return operation
      if (operation.state !== "running" || operation.ammRunId) {
        throw new AmmServiceError("amm_operation_state_conflict")
      }

      const updatedAt = clock()
      const updated: AmmOperation = {
        ...operation,
        ammRunId: input.ammRunId,
        state: "running",
        updatedAt,
      }
      await transaction.updateOperation(operation.id, {
        ammRunId: input.ammRunId,
        state: "running",
        updatedAt,
      })
      return updated
    })
  }

  function prepareAmmOperationCancellation(input: OwnedAmmOperationInput) {
    return store.transaction(async (transaction) => {
      const operation = await transaction.findOwnedOperationForUpdate(
        input.organizationId,
        input.operationId,
      )
      if (!operation) return null
      if (operation.state === "completed") {
        throw new AmmServiceError("amm_operation_state_conflict")
      }
      if (operation.state === "cancelled") {
        return { kind: "cancelled" as const, operation }
      }
      if (operation.state === "running") {
        return operation.ammRunId
          ? { kind: "run_attached" as const, operation }
          : { kind: "start_pending" as const, operation }
      }

      const bucket = requireOperationBucket(
        await transaction.findOperationBucketForUpdate(operation),
      )
      const completedAt = clock()
      await transaction.updateBucket(bucket.id, {
        reservedUnits: releasedReservationUnits(bucket, operation),
        usedUnits: bucket.usedUnits,
        updatedAt: completedAt,
      })
      await transaction.updateOperation(operation.id, {
        completedAt,
        state: "cancelled",
        updatedAt: completedAt,
      })
      return {
        kind: "cancelled" as const,
        operation: { ...operation, completedAt, state: "cancelled" as const, updatedAt: completedAt },
      }
    })
  }

  function cancelOwnedAmmOperation(input: OwnedAmmOperationInput) {
    return store.transaction(async (transaction) => {
      const operation = await transaction.findOwnedOperationForUpdate(
        input.organizationId,
        input.operationId,
      )
      if (!operation) return null
      if (operation.state === "cancelled") return operation
      if (operation.state === "completed") {
        throw new AmmServiceError("amm_operation_state_conflict")
      }
      if (operation.state === "running" && !operation.ammRunId) {
        throw new AmmServiceError("amm_operation_state_conflict")
      }

      const bucket = requireOperationBucket(
        await transaction.findOperationBucketForUpdate(operation),
      )
      const completedAt = clock()
      await transaction.updateBucket(bucket.id, {
        reservedUnits: releasedReservationUnits(bucket, operation),
        usedUnits: bucket.usedUnits,
        updatedAt: completedAt,
      })
      await transaction.updateOperation(operation.id, {
        completedAt,
        state: "cancelled",
        updatedAt: completedAt,
      })
      return { ...operation, completedAt, state: "cancelled" as const, updatedAt: completedAt }
    })
  }

  function reconcileAmmOperation(input: ReconcileAmmOperationInput) {
    requireNonnegativeUnits(input.actualUnits)
    requireProviderCalls(input.providerCalls)
    requireUpstreamCostUsd(input.upstreamCostUsd)

    return store.transaction(async (transaction) => {
      const operation = await transaction.findOwnedOperationForUpdate(
        input.organizationId,
        input.operationId,
      )
      if (!operation) return null
      if (operation.state === "completed") return operation
      if (operation.state === "cancelled") {
        throw new AmmServiceError("amm_operation_state_conflict")
      }

      const bucket = requireOperationBucket(
        await transaction.findOperationBucketForUpdate(operation),
      )
      const actualUnits = Math.min(input.actualUnits, operation.reservedUnits)
      const completedAt = clock()
      const ledgerEntry: AmmUsageLedgerEntry = {
        id: createDenTypeId("ammUsageLedgerEntry"),
        organizationId: operation.organizationId,
        orgMembershipId: operation.orgMembershipId,
        operationId: operation.id,
        event: "completed",
        capability: operation.operation,
        quantityUnits: actualUnits,
        providerCalls: input.providerCalls,
        upstreamCostUsd: input.upstreamCostUsd,
        createdAt: completedAt,
      }

      await transaction.insertLedgerEntry(ledgerEntry)
      await transaction.updateBucket(bucket.id, {
        reservedUnits: releasedReservationUnits(bucket, operation),
        usedUnits: bucket.usedUnits + actualUnits,
        updatedAt: completedAt,
      })
      await transaction.updateOperation(operation.id, {
        actualUnits,
        completedAt,
        providerCalls: input.providerCalls,
        state: "completed",
        updatedAt: completedAt,
        upstreamCostUsd: input.upstreamCostUsd,
      })

      return {
        ...operation,
        actualUnits,
        completedAt,
        providerCalls: input.providerCalls,
        state: "completed" as const,
        updatedAt: completedAt,
        upstreamCostUsd: input.upstreamCostUsd,
      }
    })
  }

  return {
    attachAmmRun,
    beginAmmOperationStart,
    cancelOwnedAmmOperation,
    getOwnedAmmOperation,
    prepareAmmOperationCancellation,
    reconcileAmmOperation,
    reserveAmmOperation,
  }
}

const ammService = createAmmService(new DrizzleAmmStore())

export const attachAmmRun = ammService.attachAmmRun
export const beginAmmOperationStart = ammService.beginAmmOperationStart
export const cancelOwnedAmmOperation = ammService.cancelOwnedAmmOperation
export const getOwnedAmmOperation = ammService.getOwnedAmmOperation
export const prepareAmmOperationCancellation = ammService.prepareAmmOperationCancellation
export const reconcileAmmOperation = ammService.reconcileAmmOperation
export const reserveAmmOperation = ammService.reserveAmmOperation
