import { relations } from "drizzle-orm"
import {
  bigint,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core"
import { denTypeIdColumn, timestamps } from "../columns"
import { MemberTable, OrganizationTable } from "./org"

export const AmmOperationState = ["reserved", "running", "completed", "cancelled"] as const

export const AmmOperationTable = mysqlTable(
  "amm_operations",
  {
    id: denTypeIdColumn("ammOperation", "id").notNull().primaryKey(),
    organizationId: denTypeIdColumn("organization", "organization_id").notNull(),
    orgMembershipId: denTypeIdColumn("member", "org_membership_id").notNull(),
    operationKey: varchar("operation_key", { length: 128 }).notNull(),
    operation: varchar("operation", { length: 128 }).notNull(),
    requestDigest: varchar("request_digest", { length: 255 }).notNull(),
    ammRunId: varchar("amm_run_id", { length: 128 }),
    state: mysqlEnum("state", AmmOperationState).notNull().default("reserved"),
    reservedUnits: bigint("reserved_units", { mode: "number" }).notNull(),
    actualUnits: bigint("actual_units", { mode: "number" }).notNull().default(0),
    providerCalls: int("provider_calls").notNull().default(0),
    upstreamCostUsd: decimal("upstream_cost_usd", { precision: 20, scale: 8 })
      .notNull()
      .default("0"),
    createdAt: timestamps.created_at,
    updatedAt: timestamps.updated_at,
    completedAt: timestamp("completed_at", { fsp: 3 }),
  },
  (table) => [
    uniqueIndex("amm_operations_organization_key").on(
      table.organizationId,
      table.operationKey,
    ),
    index("amm_operations_organization_id").on(table.organizationId),
    index("amm_operations_org_membership_id").on(table.orgMembershipId),
    index("amm_operations_amm_run_id").on(table.ammRunId),
  ],
)

export const AmmUsageBucketTable = mysqlTable(
  "amm_usage_buckets",
  {
    id: denTypeIdColumn("ammUsageBucket", "id").notNull().primaryKey(),
    organizationId: denTypeIdColumn("organization", "organization_id").notNull(),
    limitUnits: bigint("limit_units", { mode: "number" }).notNull(),
    reservedUnits: bigint("reserved_units", { mode: "number" }).notNull().default(0),
    usedUnits: bigint("used_units", { mode: "number" }).notNull().default(0),
    windowStartAt: timestamp("window_start_at", { fsp: 3 }).notNull(),
    windowEndAt: timestamp("window_end_at", { fsp: 3 }).notNull(),
    createdAt: timestamps.created_at,
    updatedAt: timestamps.updated_at,
  },
  (table) => [
    index("amm_usage_buckets_organization_window").on(
      table.organizationId,
      table.windowStartAt,
      table.windowEndAt,
    ),
  ],
)

export const AmmUsageLedgerEntryTable = mysqlTable(
  "amm_usage_ledger_entries",
  {
    id: denTypeIdColumn("ammUsageLedgerEntry", "id").notNull().primaryKey(),
    organizationId: denTypeIdColumn("organization", "organization_id").notNull(),
    orgMembershipId: denTypeIdColumn("member", "org_membership_id").notNull(),
    operationId: denTypeIdColumn("ammOperation", "operation_id").notNull(),
    event: varchar("event", { length: 32 }).notNull(),
    capability: varchar("capability", { length: 128 }).notNull(),
    quantityUnits: bigint("quantity_units", { mode: "number" }).notNull(),
    providerCalls: int("provider_calls").notNull(),
    upstreamCostUsd: decimal("upstream_cost_usd", { precision: 20, scale: 8 }).notNull(),
    createdAt: timestamps.created_at,
  },
  (table) => [
    uniqueIndex("amm_usage_ledger_entries_operation_event").on(
      table.operationId,
      table.event,
    ),
    index("amm_usage_ledger_entries_organization_id").on(table.organizationId),
    index("amm_usage_ledger_entries_org_membership_id").on(table.orgMembershipId),
  ],
)

export const ammOperationRelations = relations(AmmOperationTable, ({ many, one }) => ({
  organization: one(OrganizationTable, {
    fields: [AmmOperationTable.organizationId],
    references: [OrganizationTable.id],
  }),
  orgMembership: one(MemberTable, {
    fields: [AmmOperationTable.orgMembershipId],
    references: [MemberTable.id],
  }),
  ledgerEntries: many(AmmUsageLedgerEntryTable),
}))

export const ammUsageBucketRelations = relations(AmmUsageBucketTable, ({ one }) => ({
  organization: one(OrganizationTable, {
    fields: [AmmUsageBucketTable.organizationId],
    references: [OrganizationTable.id],
  }),
}))

export const ammUsageLedgerEntryRelations = relations(
  AmmUsageLedgerEntryTable,
  ({ one }) => ({
    organization: one(OrganizationTable, {
      fields: [AmmUsageLedgerEntryTable.organizationId],
      references: [OrganizationTable.id],
    }),
    orgMembership: one(MemberTable, {
      fields: [AmmUsageLedgerEntryTable.orgMembershipId],
      references: [MemberTable.id],
    }),
    operation: one(AmmOperationTable, {
      fields: [AmmUsageLedgerEntryTable.operationId],
      references: [AmmOperationTable.id],
    }),
  }),
)

export const ammOperation = AmmOperationTable
export const ammUsageBucket = AmmUsageBucketTable
export const ammUsageLedgerEntry = AmmUsageLedgerEntryTable
