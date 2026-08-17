# KDP Research Live Integration and E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect AI Work Magic, its local KDP research skill and Portfolio, Den's public MCP gateway, and the existing `ai-api-magic` research service, then prove the complete feature with hard-capped real provider calls from the browser experience.

**Architecture:** AI Work Magic remains the customer UI and local project system. Den authenticates the user and organization, checks an AMM entitlement, reserves capability quota, exposes thin KDP operations through `/mcp/agent`, and invokes private `ai-api-magic` with one service bearer credential and no customer identifiers. `ai-api-magic` owns asynchronous provider execution, operational provider usage/cost, evidence, and the global corpus; Den owns customer-to-operation mappings and commercial reconciliation. The installed KDP skill orchestrates Den capabilities and writes the reviewed niche brief and evidence artifact into the workspace-local Portfolio.

**Tech Stack:** TypeScript, Hono, Zod, Drizzle/MySQL (Den), Next.js route handlers, PostgreSQL, pg-boss (`ai-api-magic`), OpenCode/OpenWork skills, local Portfolio SQLite, `@openwork/testkit`, CDP/Playwright MCP, Vitest, pnpm.

## Global Constraints

- Work on the current local branches. Do not create a git worktree.
- Preserve unrelated changes in `ai-work-magic`, including the existing `.opencode/package-lock.json`, `.amm/`, and `portfolio.yaml` changes.
- Den is the only public API/MCP gateway and the only authority for users, organizations, memberships, AMM entitlement, customer quota, and customer-visible operation ownership.
- `ai-api-magic` receives no Den tenant, organization, member, subscription, entitlement, quota, or billing identifiers.
- Den authenticates to `ai-api-magic` with `Authorization: Bearer <DEN_TO_AMM_SERVICE_KEY>`; the key must never enter Vite variables, browser storage, chat messages, screenshots, test tapes, or Portfolio artifacts.
- Den sends a globally unique AMM idempotency key and `X-Request-Id`; no identity headers are permitted on the Den-to-AMM request.
- The market corpus is global and reusable. Only rights-approved generic observations may enter it; workspace/project/customer identifiers and private decisions may not.
- Customer projects, briefs, decisions, and artifact files remain in the selected AI Work Magic workspace and `.amm/portfolio.sqlite`.
- Real provider tests must use one keyword, `search.depth: 3`, `maxProducts: 3`, `maxPages: 1`, and `maxUnits: 20`. Do not broaden those limits while diagnosing a failure.
- The live lane requires real DataForSEO and SerpApi calls. MerchantWords may participate in the expansion smoke only after the collection proof passes. Never print environment values.
- The authoritative pass/fail artifact is an `evals/specs/**/*.slow.test.ts` `@openwork/testkit` tape. Playwright MCP is the interactive browser driver and diagnostic witness, not the sole assertion mechanism.
- The test must prove the negative boundaries: no browser-visible service key, no Den identity in AMM requests/corpus, no duplicate paid execution on retry, no Portfolio mutation in a different workspace, and no publishing/book-creation side effect.
- Stripe checkout and production pricing are outside this first live slice. The test organization receives an explicitly seeded AMM entitlement and finite capability-unit bucket; the schema and ledger must be suitable for later Stripe activation.

---

## Target End-to-End Contract

```text
Playwright MCP / @openwork/testkit
  -> AI Work Magic headless web chat
  -> workspace-local kdp-niche-research skill
  -> local portfolio.inspect / portfolio.initialize / portfolio.project.create
  -> openwork-cloud search_capabilities / execute_capability
  -> Den native AMM route
       authenticate MCP principal
       verify organization membership + AMM entitlement
       reserve AMM capability units
       persist Den operation ownership
  -> ai-api-magic private REST API
       validate service key
       reuse global corpus or call real providers
       queue and execute managed run
       report evidence + actual provider usage/cost
  -> Den reconciles reservation and authorizes result read
  -> agent produces evidence-backed niche brief
  -> local Portfolio project + workspace artifact registration
```

The first callable Den operations are deliberately small:

| MCP operationId | Den HTTP route | AMM downstream route |
| --- | --- | --- |
| `startAmmKdpKeywordCollection` | `POST /v1/amm/kdp/keyword-collections` | `POST /api/v1/kdp/keyword-collections` |
| `getAmmResearchOperation` | `GET /v1/amm/operations/:operationId` | `GET /api/v1/runs/:runId` |
| `cancelAmmResearchOperation` | `DELETE /v1/amm/operations/:operationId` | `DELETE /api/v1/runs/:runId` |
| `getAmmKdpKeywordObservations` | `GET /v1/amm/kdp/keyword-observations` | `GET /api/v1/kdp/keyword-observations` |
| `scoreAmmKdpKeywords` | `POST /v1/amm/kdp/keyword-scores` | `POST /api/v1/kdp/keyword-scores` |

The MCP catalog derives these exact names from the Den OpenAPI `operationId`; do not create a second hand-maintained MCP registry.

---

### Task 1: Freeze Shared Den-to-AMM Contracts

**Files:**
- Create: `ee/apps/den-api/src/amm/contracts.ts`
- Create: `ee/apps/den-api/src/amm/contracts.test.ts`
- Reference: `../ai-api-magic/src/core/kdp/keyword-collection/schema.ts`
- Reference: `../ai-api-magic/src/app/api/v1/runs/[runId]/route.ts`

**Interfaces:**
- Consumes: the implemented `ai-api-magic` v1 request and run-result shapes.
- Produces: `startAmmKdpKeywordCollectionSchema`, `scoreAmmKdpKeywordsSchema`, `ammOperationParamsSchema`, `ammKeywordObservationQuerySchema`, `ammRunResponseSchema`, and `AmmProviderUsage`.

- [ ] **Step 1: Write contract tests for the bounded live request and identity exclusion**

```ts
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
```

- [ ] **Step 2: Run the test and verify that it fails because the contract module does not exist**

Run: `pnpm --filter @openwork-ee/den-api exec bun test src/amm/contracts.test.ts`

Expected: FAIL with an unresolved `./contracts.js` import.

- [ ] **Step 3: Implement strict Zod schemas and the downstream body mapper**

The public Den body must be a small product contract. Map it internally to:

```ts
export function toAmmCollectionBody(input: StartAmmKdpKeywordCollection) {
  return {
    schemaVersion: "amm.kdp.managed-keyword-collection.request/v1" as const,
    evaluationTargetAsOf: input.evaluationTargetAsOf,
    queries: [{
      candidateId: input.operationKey,
      normalizedKeyword: input.keyword,
      context: {
        marketplace: input.marketplace,
        language: input.language,
        department: input.department,
        targetFormat: input.targetFormat,
        currency: input.currency,
      },
      requestedMetrics: [
        "amazon_monthly_search_volume",
        "amazon_search_result_count",
        "amazon_bsr",
        "amazon_review_count",
        "amazon_rating",
        "amazon_price",
      ],
      search: { depth: input.limits.searchDepth, includeSponsored: false },
      enrichment: { mode: "top-n-organic", topN: input.limits.maxProducts, productFields: ["bsr", "reviewCount", "rating", "price"] },
    }],
    collectionIntent: input.collectionIntent,
    usageLimit: {
      unit: "amm.capability-units/v1" as const,
      maxUnits: input.limits.maxUnits,
      maxProducts: input.limits.maxProducts,
      maxPages: input.limits.maxPages,
    },
    evidenceLevel: input.evidenceLevel,
  }
}
```

Make every object schema strict. Reject keys named `tenantId`, `organizationId`, `memberId`, `userId`, `subscriptionId`, or `reservationId` at the public input and downstream serialization boundaries.

- [ ] **Step 4: Run the focused test**

Run: `pnpm --filter @openwork-ee/den-api exec bun test src/amm/contracts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

```bash
git add ee/apps/den-api/src/amm/contracts.ts ee/apps/den-api/src/amm/contracts.test.ts
git commit -m "feat(den): define AMM research contracts"
```

---

### Task 2: Add Den AMM Configuration and a Private Service Client

**Files:**
- Modify: `ee/apps/den-api/src/env.ts`
- Create: `ee/apps/den-api/src/amm/client.ts`
- Create: `ee/apps/den-api/src/amm/client.test.ts`
- Modify: `package.json` (`dev:den:api` only)

**Interfaces:**
- Consumes: `AMM_API_BASE_URL`, `DEN_TO_AMM_SERVICE_KEY`, Den request IDs, and the Task 1 schemas.
- Produces: `AmmResearchClient.startCollection`, `.getRun`, `.cancelRun`, `.getKeywordObservations`, and `.scoreKeywords`.

- [ ] **Step 1: Write an HTTP witness test**

Start an ephemeral Node HTTP server in the test and assert the captured downstream request has exactly:

```ts
expect(captured.headers.authorization).toBe("Bearer service-test-key")
expect(captured.headers["idempotency-key"]).toBe("ammop_test")
expect(captured.headers["x-request-id"]).toBe("req_test")
expect(captured.headers["x-den-organization-id"]).toBeUndefined()
expect(captured.headers["x-den-member-id"]).toBeUndefined()
expect(captured.body).not.toHaveProperty("organizationId")
```

Also assert that a 401, 409 idempotency conflict, 429, malformed body, timeout, and 5xx become stable typed errors without echoing the service key.

- [ ] **Step 2: Run the witness test and verify failure**

Run: `pnpm --filter @openwork-ee/den-api exec bun test src/amm/client.test.ts`

Expected: FAIL because `AmmResearchClient` is missing.

- [ ] **Step 3: Add environment parsing**

Add optional values to `EnvSchema` and the exported `env` object:

```ts
AMM_API_BASE_URL: z.string().url().optional(),
DEN_TO_AMM_SERVICE_KEY: z.string().min(32).optional(),
AMM_REQUEST_TIMEOUT_MS: z.string().optional(),
```

Expose them as one nullable `env.amm` object. Fail an AMM call with `amm_not_configured` when either URL or key is absent; do not prevent unrelated Den startup.

- [ ] **Step 4: Implement the client**

Use injected `fetch` and config for tests. Apply `AbortSignal.timeout`, `accept: application/json`, the service bearer, `Idempotency-Key`, and `X-Request-Id`. Never forward the incoming Den request headers wholesale.

- [ ] **Step 5: Wire local Den startup without printing secrets**

Extend `dev:den:api` so it inherits `AMM_API_BASE_URL` and `DEN_TO_AMM_SERVICE_KEY` from the shell. Do not embed either value in the command string, Vite environment, or `tmp/dev-headless-web.json`.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @openwork-ee/den-api exec bun test src/amm/client.test.ts
pnpm --filter @openwork-ee/den-api exec tsc -p tsconfig.json --noEmit
```

Expected: both commands PASS.

```bash
git add ee/apps/den-api/src/env.ts ee/apps/den-api/src/amm/client.ts ee/apps/den-api/src/amm/client.test.ts package.json
git commit -m "feat(den): add private AMM service client"
```

---

### Task 3: Persist Den Operation Ownership and a Separate AMM Usage Ledger

**Files:**
- Modify: `ee/packages/utils/src/typeid.ts`
- Create: `ee/packages/den-db/src/schema/amm.ts`
- Modify: `ee/packages/den-db/src/schema/index.ts`
- Create: the migration generated under `ee/packages/den-db/drizzle/` by `pnpm --filter @openwork-ee/den-db db:generate`
- Create: `ee/apps/den-api/src/amm/service.ts`
- Create: `ee/apps/den-api/src/amm/service.test.ts`
- Modify: `ee/apps/den-api/src/routes/org/delete-organization.ts`
- Create: `ee/apps/den-api/test/delete-organization-amm.test.ts`

**Interfaces:**
- Consumes: Den organization/member identity, `operationKey`, request digest, reserved maximum units, AMM run ID, and actual provider usage.
- Produces: `reserveAmmOperation`, `attachAmmRun`, `getOwnedAmmOperation`, `cancelOwnedAmmOperation`, and `reconcileAmmOperation`.

- [ ] **Step 1: Write failing service tests**

Cover these invariants:

```ts
it("returns the same operation for the same organization, operation key, and digest")
it("returns a conflict for the same key with a different digest")
it("does not expose an operation to another organization")
it("atomically rejects a reservation beyond the remaining bucket")
it("reconciliation is idempotent and never charges more than reserved units")
it("records provider calls and upstream USD separately from customer capability units")
```

- [ ] **Step 2: Run the focused service test and verify failure**

Run: `pnpm --filter @openwork-ee/den-api exec bun test src/amm/service.test.ts`

Expected: FAIL because the AMM tables and service do not exist.

- [ ] **Step 3: Add stable TypeID prefixes**

Append, without changing existing prefixes:

```ts
ammOperation: "aop",
ammUsageBucket: "aub",
ammUsageLedgerEntry: "aule",
```

- [ ] **Step 4: Add the minimum tables**

Create:

```text
amm_operations
  id, organization_id, org_membership_id, operation_key, operation,
  request_digest, amm_run_id, state, reserved_units, actual_units,
  provider_calls, upstream_cost_usd, created_at, updated_at, completed_at

amm_usage_buckets
  id, organization_id, limit_units, reserved_units, used_units,
  window_start_at, window_end_at, created_at, updated_at

amm_usage_ledger_entries
  id, organization_id, org_membership_id, operation_id, event,
  capability, quantity_units, provider_calls, upstream_cost_usd, created_at
```

Required uniqueness:

```text
(organization_id, operation_key)
(operation_id, event)
```

Do not add Den identifiers to any `ai-api-magic` table.

- [ ] **Step 5: Generate and inspect the migration**

Run `pnpm --filter @openwork-ee/den-db db:generate`; do not hand-number a migration. Confirm the generated SQL alters only the new AMM tables and TypeID-backed columns.

- [ ] **Step 6: Implement transactional reservation and reconciliation**

Reservation must lock/update the active bucket and create the operation in one transaction. Reconciliation must insert one `completed` ledger event and update the bucket/operation in one transaction. Provider calls and upstream USD are observability facts, not the customer's bill.

- [ ] **Step 7: Extend organization deletion**

Delete `amm_usage_ledger_entries`, `amm_operations`, and `amm_usage_buckets` in dependency order inside the existing organization-deletion transaction. Extend its test to prove no AMM control-plane row survives deletion. This affects Den data only and must not delete the shared `ai-api-magic` corpus.

- [ ] **Step 8: Verify and commit**

Run:

```bash
pnpm --filter @openwork-ee/den-db test
pnpm --filter @openwork-ee/den-api exec bun test src/amm/service.test.ts test/delete-organization-amm.test.ts
```

Expected: PASS with no inference-table modifications.

```bash
git add ee/packages/utils/src/typeid.ts ee/packages/den-db/src/schema/amm.ts ee/packages/den-db/src/schema/index.ts ee/packages/den-db/drizzle ee/apps/den-api/src/amm/service.ts ee/apps/den-api/src/amm/service.test.ts ee/apps/den-api/src/routes/org/delete-organization.ts ee/apps/den-api/test/delete-organization-amm.test.ts
git commit -m "feat(den): persist AMM operations and usage"
```

---

### Task 4: Add an Explicit AMM Entitlement for the Live Organization

**Files:**
- Modify: `ee/apps/den-api/src/entitlements.ts`
- Modify: `ee/apps/den-api/scripts/seed-demo-org.ts`
- Create: `ee/apps/den-api/src/amm/entitlement.test.ts`

**Interfaces:**
- Consumes: organization plan/metadata.
- Produces: `checkEntitlement(metadata, "ammResearch")` and one finite seeded AMM usage bucket.

- [ ] **Step 1: Add a failing entitlement test**

```ts
expect(checkEntitlement({ features: { ammResearch: true } }, "ammResearch", { gatingEnabled: true }).ok).toBe(true)
expect(checkEntitlement({ plan: { tier: "enterprise", source: "manual" } }, "ammResearch", { gatingEnabled: true }).ok).toBe(false)
```

- [ ] **Step 2: Extend `ENTITLEMENT_KEYS`**

Add `ammResearch` with the label `AMM managed research`. Preserve all existing entitlement behavior, but make AMM opt-in: `features.ammResearch === true` grants it and absence denies it even for an Enterprise organization. Plan tier alone must not silently enable paid provider execution.

- [ ] **Step 3: Seed only the designated local demo organization**

The reset seed must grant `ammResearch: true` and create one current bucket with `limit_units: 100`. Do not grant this feature implicitly to every organization in production code.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @openwork-ee/den-api exec bun test src/amm/entitlement.test.ts test/entitlements.test.ts
```

Expected: PASS.

```bash
git add ee/apps/den-api/src/entitlements.ts ee/apps/den-api/scripts/seed-demo-org.ts ee/apps/den-api/src/amm/entitlement.test.ts
git commit -m "feat(den): gate AMM managed research"
```

---

### Task 5: Publish Thin Native Den AMM Routes Through `/mcp/agent`

**Files:**
- Create: `ee/apps/den-api/src/routes/amm/index.ts`
- Modify: `ee/apps/den-api/src/app.ts`
- Modify: `ee/apps/den-api/src/mcp/policy.ts`
- Create: `ee/apps/den-api/src/routes/amm/index.test.ts`
- Test: `ee/apps/den-api/test/route-access-policy.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts, Task 2 client, Task 3 service, `orgMemberRoute()`, and `checkEntitlement`.
- Produces: the five HTTP/MCP operations in the target contract table.

- [ ] **Step 1: Write route tests with an injected AMM witness**

Prove:

```text
401: unauthenticated direct request
402: authenticated organization without ammResearch
402 or 429: insufficient AMM bucket
202: authorized start, durable Den operation ID returned
200: same operationKey + same body returns the same Den operation and AMM run
409: same operationKey + different body
404: another organization reads/cancels the operation
200: owner polls a terminal result and reconciliation happens once
200: observations are returned without customer linkage
200: scoring returns a deterministic candidate ranking without creating an asynchronous run
```

- [ ] **Step 2: Run the route test and verify failure**

Run: `pnpm --filter @openwork-ee/den-api exec bun test src/routes/amm/index.test.ts`

Expected: FAIL because the routes are not registered.

- [ ] **Step 3: Register the four routes**

Each route must use `describeRoute` with `"x-mcp": true`, a stable `operationId`, strict Zod request/response schemas, `orgMemberRoute()`, and the appropriate JSON/query/param validator. Add the `AMM Research` tag to `SAFE_INCLUDED_TAGS` as defense in depth even though `x-mcp: true` is explicit.

Start behavior:

```ts
const organization = c.get("organizationContext")
const entitlement = checkEntitlement(organization.organization.metadata, "ammResearch")
if (!entitlement.ok) return c.json(entitlement.response, entitlement.status)

const operation = await reserveAmmOperation({
  organizationId: organization.organization.id,
  orgMembershipId: organization.currentMember.id,
  operationKey: input.operationKey,
  requestDigest,
  capability: "kdp.keyword-collection",
  maximumUnits: input.limits.maxUnits,
})
```

Then call AMM with `operation.id` as `Idempotency-Key`, attach the AMM `runId`, and return the Den `operationId`. Never return the downstream run ID to the customer.

- [ ] **Step 4: Verify automatic MCP discovery**

Test `getCatalog()`/`searchCapabilities()` and assert a `kdp keyword research scoring` query returns `startAmmKdpKeywordCollection`, `getAmmResearchOperation`, `getAmmKdpKeywordObservations`, and `scoreAmmKdpKeywords`. Test `execute_capability` against the witness; do not call route functions directly for this assertion.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @openwork-ee/den-api exec bun test src/routes/amm/index.test.ts test/route-access-policy.test.ts
pnpm --filter @openwork-ee/den-api exec bun test
pnpm --filter @openwork-ee/den-api exec tsc -p tsconfig.json --noEmit
```

Expected: PASS, including route-access policy and MCP catalog tests.

```bash
git add ee/apps/den-api/src/routes/amm ee/apps/den-api/src/app.ts ee/apps/den-api/src/mcp/policy.ts ee/apps/den-api/test/route-access-policy.test.ts
git commit -m "feat(den): expose KDP research through MCP"
```

---

### Task 6: Report Actual Provider Usage from `ai-api-magic`

**Repository:** `/home/alerios/Tech/ai-agents/ai-api-magic`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/lib/env.ts`
- Modify: `src/platform/auth.ts`
- Modify: `src/jobs/worker.ts`
- Modify: `src/app/api/v1/runs/[runId]/route.ts`
- Modify: `src/db/repositories/runs.ts`
- Create: `tests/api/run-usage.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: provider attempts/calls already produced by the executor and run ID.
- Produces: a safe run response containing `usage.capabilityUnits`, `usage.providerCalls`, and `usage.upstreamCostUsd` without Den identity.

- [ ] **Step 1: Write the failing run-usage test**

For a completed KDP run, assert:

```ts
expect(body.usage).toEqual({
  capabilityUnits: expect.any(Number),
  providerCalls: expect.any(Number),
  upstreamCostUsd: expect.any(String),
})
expect(JSON.stringify(body)).not.toMatch(/organizationId|memberId|tenantId/)
```

- [ ] **Step 2: Run the test and verify the missing usage response**

Run: `pnpm exec vitest run tests/api/run-usage.test.ts`

Expected: FAIL because the run response lacks reconciliable usage.

- [ ] **Step 3: Persist idempotent operational usage**

Use the existing `usage_events` ledger. Record provider/cost facts per run and provider with a uniqueness key that survives worker retry. Do not introduce customer pricing or Den identifiers. Compute `capabilityUnits` from the versioned AMM unit policy and cap it at the request's `usageLimit.maxUnits`.

- [ ] **Step 4: Return safe aggregate usage from the run endpoint**

Aggregate only the authenticated internal service namespace and selected run. Keep provider secrets, raw upstream error bodies, and request credentials out of the response.

- [ ] **Step 5: Rename the production service credential without breaking local development**

Parse `DEN_TO_AMM_SERVICE_KEY` as the canonical deployed credential and accept `LOCAL_API_KEY` only as a documented local-development alias. Fail startup when both are present with different values. Keep the timing-safe comparison in `resolveApiPrincipal`; change only credential sourcing and the fixed principal label from `key_local` to `den_service` when the canonical variable is used.

- [ ] **Step 6: Update the service-boundary documentation**

Replace `LOCAL_API_KEY` production language with `DEN_TO_AMM_SERVICE_KEY` while retaining a documented local alias if required for developer compatibility. State that `ai-api-magic` performs service authentication and operational accounting only.

- [ ] **Step 7: Verify and commit in `ai-api-magic`**

Run:

```bash
pnpm exec vitest run tests/api/run-usage.test.ts tests/api/runs.test.ts tests/jobs/worker.test.ts
pnpm typecheck
pnpm build
```

Expected: PASS.

```bash
git add src/db/schema.ts src/lib/env.ts src/platform/auth.ts src/jobs/worker.ts src/app/api/v1/runs/'[runId]'/route.ts src/db/repositories/runs.ts tests/api/run-usage.test.ts README.md drizzle
git commit -m "feat: report managed research usage"
```

---

### Task 7: Make the Canonical KDP Skill Invoke Den and Persist Local Outcomes

**Repository:** `/home/alerios/Tech/ai-agents/ai-money-magic`

**Files:**
- Modify: `scripts/build-distributions.mjs` (`skillMarkdown()` and its KDP-only generated workflow)
- Regenerate: `verticals/kdp-niche-research/skills/kdp-niche-research/SKILL.md`
- Regenerate: `dist/opencode-openwork/.opencode/skills/kdp-niche-research/SKILL.md`
- Modify: `CHANGELOG.md`

**Install target:**
- Create: `/home/alerios/Tech/ai-agents/ai-work-magic/.opencode/skills/kdp-niche-research/SKILL.md`

**Interfaces:**
- Consumes: exact Den operations from Task 5 and local Portfolio affordances from `amm-docs/PORTFOLIO.md`.
- Produces: a deterministic agent workflow ending in a local research project and registered Markdown brief.

- [ ] **Step 1: Add a distribution assertion before changing the skill**

Add a focused assertion script or extend the existing metadata validation so the generated skill must contain:

```text
startAmmKdpKeywordCollection
getAmmResearchOperation
getAmmKdpKeywordObservations
scoreAmmKdpKeywords
portfolio.inspect
portfolio.project.create
portfolio.artifact.register
```

- [ ] **Step 2: Run the distribution check and verify failure**

Run: `node scripts/build-distributions.mjs --check`

Expected: FAIL after adding the assertion because `skillMarkdown()` currently emits only generic dependency names and the high-level Portfolio pipeline.

- [ ] **Step 3: Update the canonical workflow**

Update the KDP-only branch inside `skillMarkdown()` so the generated canonical workflow requires the agent to:

1. inspect the active local Portfolio;
2. initialize it only after the user's request implies durable KDP project work;
3. search Den for `kdp keyword research observations` and use only exact returned capability names;
4. generate one stable `operationKey` and reuse it for retries;
5. start one hard-capped collection and poll the Den operation, never an AMM run ID;
6. state partial/provider-degraded results honestly;
7. derive the documented 0–100 demand and competition inputs only from returned observations, invoke `scoreAmmKdpKeywords`, and preserve both inputs beside the returned `demand - competition` score; never invent missing metrics;
8. write `research/kdp/<slug>-niche-brief.md` containing keyword, evaluation time, metrics, products, evidence sources, diagnostics, score inputs/calculation, and next approval;
9. create/update a local `book` project in lifecycle `research` and register the brief artifact;
10. stop before book selection, manuscript creation, publication, or spend.

- [ ] **Step 4: Regenerate distributions and install the generated skill**

Run:

```bash
node scripts/build-distributions.mjs
node scripts/build-distributions.mjs --check
```

Copy the generated directory, not a hand-edited variant, to `ai-work-magic/.opencode/skills/kdp-niche-research/`. Preserve unrelated `.opencode` state.

- [ ] **Step 5: Verify and commit each repository separately**

In `ai-money-magic`:

```bash
node scripts/validate-metadata.mjs
node scripts/build-distributions.mjs --check
git add scripts/build-distributions.mjs verticals/kdp-niche-research dist CHANGELOG.md
git commit -m "feat: connect KDP research skill to Den"
```

In `ai-work-magic`:

```bash
git add .opencode/skills/kdp-niche-research/SKILL.md
git commit -m "feat: install KDP niche research skill"
```

Do not add `.opencode/package-lock.json`, `.amm/`, or `portfolio.yaml` unless the user separately requests those existing changes.

---

### Task 8: Add a Secret-Safe Local Full-Stack Launch and Preflight

**Files:**
- Create: `scripts/amm-kdp-live-preflight.mjs`
- Modify: `package.json`
- Reference: `amm-docs/KDP_RESEARCH_LIVE_E2E_IMPLEMENTATION_PLAN.md`

**Interfaces:**
- Consumes: running Den web/API at `http://localhost:3005`/`http://localhost:8790`, AMM API at `http://127.0.0.1:3000`, AMM PostgreSQL/worker, and existing secret environment.
- Produces: non-sensitive readiness JSON and exit code.

- [ ] **Step 1: Write the preflight with value-presence checks only**

It must check:

```text
GET http://127.0.0.1:3000/api/v1/health == 200
GET http://127.0.0.1:3000/api/v1/ready == 200
GET http://127.0.0.1:8790/health == 200
GET http://127.0.0.1:8790/ready == 200
DEN_TO_AMM_SERVICE_KEY is present and length >= 32
DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD, and SERPAPI_API_KEY are present
```

Print only `present`/`missing`, endpoints, and status codes.

- [ ] **Step 2: Add scripts**

```json
{
  "amm:kdp:preflight": "node scripts/amm-kdp-live-preflight.mjs",
  "amm:kdp:headless": "VITE_DEN_BASE_URL=http://localhost:3005 pnpm dev:headless-web"
}
```

- [ ] **Step 3: Document and exercise the launch order**

Terminal A — AMM database/API:

```bash
cd /home/alerios/Tech/ai-agents/ai-api-magic
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Terminal B — AMM worker:

```bash
cd /home/alerios/Tech/ai-agents/ai-api-magic
pnpm worker
```

Terminal C — Den dependencies and reset seed:

```bash
cd /home/alerios/Tech/ai-agents/ai-work-magic
pnpm dev:den:mysql
pnpm dev:den:db-push
pnpm dev:den:seed-demo:reset
```

Terminal D — Den with private AMM configuration inherited from the secret environment:

```bash
cd /home/alerios/Tech/ai-agents/ai-work-magic
AMM_API_BASE_URL=http://127.0.0.1:3000 pnpm dev:den
```

Terminal E — AI Work Magic headless web:

```bash
cd /home/alerios/Tech/ai-agents/ai-work-magic
VITE_DEN_BASE_URL=http://localhost:3005 pnpm dev:headless-web --detach --replace
```

Read `tmp/dev-headless-web.json` for `webUrl`; do not print its bearer tokens.

- [ ] **Step 4: Verify and commit**

Run: `pnpm amm:kdp:preflight`

Expected: exit 0 with all dependencies `present`/healthy and no secret values.

```bash
git add scripts/amm-kdp-live-preflight.mjs package.json amm-docs/KDP_RESEARCH_LIVE_E2E_IMPLEMENTATION_PLAN.md
git commit -m "test: add KDP live stack preflight"
```

---

### Task 9: Add the Authoritative Live Browser Spec

**Files:**
- Create: `evals/specs/kdp-research-live.slow.test.ts`

**Interfaces:**
- Consumes: `needs()`, `server()`, `app()`, AI Work Magic chat behaviors, Den session helpers, local Portfolio UI/API, and the real AMM/provider stack.
- Produces: one ambient testkit tape proving the complete user journey and its negative boundaries.

- [ ] **Step 1: Declare live requirements explicitly**

Inside the test:

```ts
test("KDP research flows through Den and real AMM providers into the local Portfolio", async () => {
  needs({
    model: "tool-capable",
    optIn: ["OPENWORK_EVAL_APP_SPECS", "OPENWORK_EVAL_KDP_LIVE"],
    env: [
      "DEN_TO_AMM_SERVICE_KEY",
      "DATAFORSEO_LOGIN",
      "DATAFORSEO_PASSWORD",
      "SERPAPI_API_KEY",
    ],
  })
  // Test body follows.
})
```

- [ ] **Step 2: Build the browser journey**

Use a unique workspace and keyword marker. In the UI:

1. sign into the seeded Den organization;
2. verify `openwork-cloud` reports healthy;
3. create/select a workspace;
4. open Portfolio and initialize `KDP Live Research` if uninitialized;
5. open chat and select the installed `kdp-niche-research` skill;
6. send exactly:

```text
Research the Amazon.com paperback niche "fantasy romance" using the managed KDP capability and real provider evidence. Use at most 20 capability units, 3 search results, 3 enriched products, and 1 page. Create a local research-stage book project and register the final Markdown niche brief in this workspace. Do not create a manuscript, publish, or spend beyond this research request.
```

7. wait up to 180 seconds for the Den/AMM operation to reach a terminal state;
8. verify the assistant reports evidence, diagnostics, score inputs/calculation, and an explicit human-review next step.

- [ ] **Step 3: Add positive machine assertions**

Assert through UI, Den API, local Portfolio API/SQLite, AMM PostgreSQL, and logs:

```text
Den search returned startAmmKdpKeywordCollection
one Den amm_operations row exists for the test organization and operation key
one AMM managed_runs row exists for the downstream run
AMM terminal state is succeeded or partially_succeeded with explicit warnings
at least one real provider usage event exists for DataForSEO or SerpApi
provider_calls >= 1 and upstream_cost_usd >= 0
one Den completion ledger event reconciled the reservation
the chat displays demand/competition evidence and source timestamps
the Portfolio contains one research-stage book project
the registered artifact path is workspace-relative and exists
the brief includes the keyword, evidence, score inputs/calculation, diagnostics, and approval boundary
```

- [ ] **Step 4: Add negative machine assertions**

Assert:

```text
the browser DOM, localStorage, sessionStorage, network response bodies, chat transcript,
Portfolio YAML/SQLite, brief, screenshots, and tape do not contain the service key

the AMM captured request headers/body and corpus rows contain no Den organization,
member, user, subscription, reservation, workspace, project, or Portfolio identifiers

no manuscript, publication, campaign, or non-research Portfolio project was created
the alternate workspace remains uninitialized or unchanged
```

Use a redacted fingerprint for the service-key absence witness; never place the raw key in an assertion message.

- [ ] **Step 5: Prove idempotent retry without another paid execution**

Repeat `execute_capability` with the identical `operationKey` and body. Assert the same Den operation is returned, the same AMM run remains attached, `managed_runs` count does not increase, and provider usage event count/cost does not increase.

- [ ] **Step 6: Record visual evidence without making it the verdict**

Use `screenshot()` for:

```text
cloud connection ready
research request in chat
terminal evidence-backed reply
Portfolio project and registered brief
```

Use `validate()` for visible claims, while tape facts and direct assertions remain authoritative.

- [ ] **Step 7: Run the live spec locally**

```bash
OPENWORK_EVAL_APP_SPECS=1 \
OPENWORK_EVAL_KDP_LIVE=1 \
pnpm --dir evals exec vitest run \
  --config vitest.config.ts \
  --project stack \
  specs/kdp-research-live.slow.test.ts
```

Expected: one test PASS, zero skips. A skip is `Incomplete`, never `Passed`.

- [ ] **Step 8: Commit the spec**

```bash
git add evals/specs/kdp-research-live.slow.test.ts
git commit -m "test: prove live KDP research end to end"
```

---

### Task 10: Run the Same Journey with Playwright MCP

**Files:**
- No product files should change.
- Evidence may be written only through the repository's ambient testkit/evidence system.

**Interfaces:**
- Consumes: the live stack and `webUrl` from `tmp/dev-headless-web.json`.
- Produces: an interactive reproduction that agrees with the authoritative spec.

- [ ] **Step 1: Open the headless web URL with Playwright MCP**

Navigate to the manifest's `webUrl`. Complete Den's local copy/paste sign-in handoff if the browser profile is not already authorized.

- [ ] **Step 2: Inspect connection and skill availability**

Verify the Account/Connect UI shows OpenWork Cloud ready and the local skills inventory contains `kdp-niche-research`. In chat context, verify the agent can discover `startAmmKdpKeywordCollection` through `openwork-cloud_search_capabilities`.

- [ ] **Step 3: Execute the exact Task 9 prompt**

Do not alter limits or add hidden IDs. Observe tool calls, asynchronous progress, and final response. If a human approval prompt appears for the research-only action, record it as a product mismatch; do not bypass it with direct API calls.

- [ ] **Step 4: Inspect the local Portfolio**

Navigate to the Portfolio page, verify the research-stage project and brief artifact, open the workspace-relative Markdown file, and confirm its evidence/score/approval sections.

- [ ] **Step 5: Compare Playwright observations with the testkit tape**

Every claimed success must correspond to a Task 9 machine assertion. Differences produce a `Failed` or `Incomplete` verdict with exact reproduction steps; screenshots alone cannot upgrade the verdict.

---

### Task 11: Cold-Boot Verification and Handoff

**Files:**
- Modify: `amm-docs/PORTFOLIO.md` to add the verified KDP research skill example and state that Den research results are committed locally as Portfolio artifacts.
- Modify: `CHANGELOG.md` in each repository for its own implementation slice.

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: a reproducible final verdict and operator runbook.

- [ ] **Step 1: Run repository verification**

`ai-api-magic`:

```bash
pnpm verify
```

`ai-money-magic`:

```bash
node scripts/validate-metadata.mjs
node scripts/build-distributions.mjs --check
```

`ai-work-magic` focused verification:

```bash
pnpm --filter @openwork/types build
pnpm --filter @openwork-ee/den-db build
pnpm --filter @openwork-ee/den-api exec bun test
pnpm --filter @openwork-ee/den-api exec tsc -p tsconfig.json --noEmit
pnpm --filter @openwork/app typecheck
pnpm --dir evals typecheck
```

- [ ] **Step 2: Cold boot the complete stack**

Stop the warm Den, AMM API/worker, and headless web processes through their documented non-destructive shutdown paths. Restart from Task 8 without a warm Den reuse override. Do not delete developer databases; use the reset seed only for Den's designated local demo data.

- [ ] **Step 3: Run the authoritative live spec once on the final commits**

Run the exact Task 9 command. Record command, commit IDs for all three repositories, exit code, passed/failed/skipped counts, Den operation ID, redacted AMM run reference, provider names, capability units, provider calls, upstream cost, corpus hit status, and artifact path.

- [ ] **Step 4: Assign the verdict**

```text
Passed     every positive and negative assertion passed; zero skips
Incomplete infrastructure or credential requirement prevented an assertion; include exact need
Failed     product behavior violated an assertion; include exact repro and preserved evidence
```

- [ ] **Step 5: Commit final documentation separately in each affected repository**

Never combine unrelated existing changes. Do not push or open a PR unless separately requested.

---

## Acceptance Checklist

- [ ] The KDP skill is installed from the generated `ai-money-magic` distribution, not manually forked.
- [ ] Den `/mcp/agent` discovers and executes the five native AMM operations.
- [ ] Den rejects missing entitlement and insufficient AMM quota before contacting `ai-api-magic`.
- [ ] Den persists customer-to-operation ownership and never exposes the downstream AMM run ID.
- [ ] `ai-api-magic` authenticates only the Den service key and receives no customer identifiers.
- [ ] Real DataForSEO or SerpApi execution is observed within the hard limits.
- [ ] AMM reports operational provider usage/cost and Den reconciles exactly once.
- [ ] Repeating the same operation key does not create another AMM run or provider charge.
- [ ] The result includes evidence, timestamps, diagnostics, and transparent score inputs/calculation.
- [ ] A research-stage local Portfolio project and workspace-relative Markdown artifact exist.
- [ ] Another workspace remains unchanged.
- [ ] No manuscript, publication, campaign, or unapproved consequential action occurs.
- [ ] The service key and Den identifiers are absent from browser state, chat, artifacts, tape, AMM requests, and corpus records as applicable.
- [ ] The cold-boot `@openwork/testkit` live spec passes with zero skips.

## Explicit Follow-Ups Outside This Plan

- Add an AMM Stripe product/price and checkout flow after the live entitlement/quota/reconciliation slice is stable.
- Add KDP expansion and TikTok trend capabilities through the same Den operation protocol after keyword collection passes.
- Replace a static service key with signed short-lived downstream assertions when deployment risk justifies it.
- Remove the fixed `tenant_local` implementation detail from corpus identity in `ai-api-magic`; it is acceptable for this slice only because all corpus data is intentionally global and contains no customer linkage.
