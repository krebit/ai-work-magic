import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test"
import { Hono } from "hono"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  delete process.env.LINEAR_API_KEY
  delete process.env.LINEAR_COMPLIANCE_TEAM_ID
}

const deletedOrganizationId = createDenTypeId("organization")
const survivingOrganizationId = createDenTypeId("organization")
const deletedMemberId = createDenTypeId("member")
const userId = createDenTypeId("user")
const sessionId = createDenTypeId("session")
const deletedOperationId = createDenTypeId("ammOperation")
const survivingOperationId = createDenTypeId("ammOperation")

type OrganizationRow = { id: string; name: string; createdAt: Date }
type AmmRow = { id: string; organizationId: string }
type AmmLedgerRow = AmmRow & { operationId: string }

const organization: OrganizationRow = {
  id: deletedOrganizationId,
  name: "AMM Deletion Test",
  createdAt: new Date("2026-08-17T00:00:00.000Z"),
}

const state: {
  buckets: AmmRow[]
  ledgerEntries: AmmLedgerRow[]
  operations: AmmRow[]
} = {
  buckets: [],
  ledgerEntries: [],
  operations: [],
}
const ammDeleteOrder: string[] = []

function resetState() {
  state.buckets = [
    { id: createDenTypeId("ammUsageBucket"), organizationId: deletedOrganizationId },
    { id: createDenTypeId("ammUsageBucket"), organizationId: survivingOrganizationId },
  ]
  state.operations = [
    { id: deletedOperationId, organizationId: deletedOrganizationId },
    { id: survivingOperationId, organizationId: survivingOrganizationId },
  ]
  state.ledgerEntries = [
    {
      id: createDenTypeId("ammUsageLedgerEntry"),
      operationId: deletedOperationId,
      organizationId: deletedOrganizationId,
    },
    {
      id: createDenTypeId("ammUsageLedgerEntry"),
      operationId: survivingOperationId,
      organizationId: survivingOrganizationId,
    },
  ]
  ammDeleteOrder.length = 0
}

function isPropertyRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null
}

function tableName(table: unknown) {
  if (!isPropertyRecord(table)) return "unknown"
  const nameSymbol = Object.getOwnPropertySymbols(table).find(
    (symbol) => symbol.description === "drizzle:Name",
  )
  const name = nameSymbol ? table[nameSymbol] : null
  return typeof name === "string" ? name : "unknown"
}

function selectedRows(table: unknown): unknown[] {
  switch (tableName(table)) {
    case "member":
      return [{ id: deletedMemberId, userId }]
    case "organization":
      return [organization]
    default:
      return []
  }
}

function conditionStringValue(condition: unknown) {
  if (!isPropertyRecord(condition) || !Array.isArray(condition.queryChunks)) return null
  for (const chunk of condition.queryChunks) {
    if (isPropertyRecord(chunk) && typeof chunk.value === "string") return chunk.value
  }
  return null
}

function deleteRows(table: unknown, condition: unknown) {
  const name = tableName(table)
  const organizationId = conditionStringValue(condition)
  if (name.startsWith("amm_") && !organizationId) {
    throw new Error(`Missing organization filter for ${name}`)
  }
  if (name === "amm_usage_ledger_entries") {
    ammDeleteOrder.push(name)
    state.ledgerEntries = state.ledgerEntries.filter(
      (row) => row.organizationId !== organizationId,
    )
  }
  if (name === "amm_operations") {
    if (state.ledgerEntries.some((row) => row.organizationId === organizationId)) {
      throw new Error("AMM ledger entries must be deleted before operations")
    }
    ammDeleteOrder.push(name)
    state.operations = state.operations.filter(
      (row) => row.organizationId !== organizationId,
    )
  }
  if (name === "amm_usage_buckets") {
    if (state.operations.some((row) => row.organizationId === organizationId)) {
      throw new Error("AMM operations must be deleted before buckets")
    }
    ammDeleteOrder.push(name)
    state.buckets = state.buckets.filter(
      (row) => row.organizationId !== organizationId,
    )
  }
}

const transaction = {
  delete: (table: unknown) => ({
    where: (condition: unknown) => {
      deleteRows(table, condition)
      return Promise.resolve()
    },
  }),
  select: (_selection: unknown) => ({
    from: (table: unknown) => ({
      where: (_condition: unknown) => Promise.resolve(selectedRows(table)),
    }),
  }),
  update: (_table: unknown) => ({
    set: (_values: unknown) => ({
      where: (_condition: unknown) => Promise.resolve(),
    }),
  }),
}

mock.module("../src/db.js", () => ({
  db: {
    ...transaction,
    transaction: async (run: (tx: typeof transaction) => Promise<void>) => {
      const snapshot = structuredClone(state)
      try {
        await run(transaction)
      } catch (error) {
        state.buckets = snapshot.buckets
        state.ledgerEntries = snapshot.ledgerEntries
        state.operations = snapshot.operations
        throw error
      }
    },
  },
}))

mock.module("../src/stripe-billing.js", () => ({
  cancelOrganizationSubscriptions: () => Promise.resolve(),
}))

mock.module("../src/linear.js", () => ({
  createLinearIssue: () => Promise.resolve(null),
  completeLinearIssue: () => Promise.resolve(false),
}))

mock.module("../src/mcp/auth.js", () => ({
  getMcpResourceContext: () => ({ resource: "agent" }),
  verifyMcpRequest: () => Promise.resolve(new Response(null, { status: 401 })),
}))

mock.module("../src/orgs.js", () => ({
  getOrganizationContextForUser: (input: { organizationId: string; userId: string }) => Promise.resolve(
    input.organizationId === deletedOrganizationId && input.userId === userId
      ? {
          organization: {
            id: deletedOrganizationId,
            name: organization.name,
            slug: "amm-deletion-test",
            logo: null,
            metadata: null,
          },
          currentMember: {
            id: deletedMemberId,
            userId,
            role: "owner",
            isOwner: true,
            createdAt: new Date(),
          },
          members: [],
          invitations: [],
          roles: [],
          teams: [],
          currentMemberTeams: [],
        }
      : null,
  ),
  listTeamsForMember: () => Promise.resolve([]),
  resolveUserOrganizations: () => Promise.resolve({
    orgs: [],
    activeOrgId: deletedOrganizationId,
    activeOrgSlug: "amm-deletion-test",
  }),
  setSessionActiveOrganization: () => Promise.resolve(),
}))

let deleteOrganizationModule: typeof import("../src/routes/org/delete-organization.js")

beforeAll(async () => {
  seedRequiredEnv()
  deleteOrganizationModule = await import("../src/routes/org/delete-organization.js")
  mock.restore()
})

beforeEach(resetState)

afterAll(() => {
  mock.restore()
})

function createApp() {
  const app = new Hono()
  app.use("*", async (context, next) => {
    context.set("user", {
      id: userId,
      email: "owner@amm-delete.test",
      emailVerified: true,
      name: "Owner",
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    context.set("session", {
      id: sessionId,
      activeOrganizationId: deletedOrganizationId,
      createdAt: new Date(),
    })
    context.set("apiKey", null)
    await next()
  })
  deleteOrganizationModule.registerDeleteOrganizationRoutes(app)
  return app
}

test("organization deletion removes only the organization's AMM rows in dependency order", async () => {
  const response = await createApp().request("http://den.local/v1/org", { method: "DELETE" })

  expect(response.status).toBe(200)
  expect(ammDeleteOrder).toEqual([
    "amm_usage_ledger_entries",
    "amm_operations",
    "amm_usage_buckets",
  ])
  expect(state.ledgerEntries).toEqual([
    expect.objectContaining({ organizationId: survivingOrganizationId }),
  ])
  expect(state.operations).toEqual([
    expect.objectContaining({ organizationId: survivingOrganizationId }),
  ])
  expect(state.buckets).toEqual([
    expect.objectContaining({ organizationId: survivingOrganizationId }),
  ])
})
