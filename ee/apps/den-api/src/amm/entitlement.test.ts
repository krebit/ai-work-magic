import { expect, it } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

seedRequiredEnv()
const { checkEntitlement } = await import("../entitlements.js")

it("AMM managed research requires an explicit organization opt-in", () => {
  expect(checkEntitlement({ features: { ammResearch: true } }, "ammResearch", { gatingEnabled: true }).ok).toBe(true)
  expect(checkEntitlement({ plan: { tier: "enterprise", source: "manual" } }, "ammResearch", { gatingEnabled: true }).ok).toBe(false)
})
