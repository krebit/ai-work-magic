# Generic Portfolio Research History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-local, longitudinal research history to generic Portfolio projects and expose it through the local API, OpenCode chat, and Portfolio UI.

**Architecture:** Existing Portfolio projects remain the universal identity. `@openwork/amm-portfolio` migrates its SQLite database to schema version 2 and owns typed append-only research records. The local server, renderer client, semantic OpenCode tools, and UI consume that one repository contract.

**Tech Stack:** TypeScript, Better SQLite3, Node test runner/tsx, Bun tests, Zod, React, TanStack Query, OpenWork local server, OpenCode plugin tools.

## Global Constraints

- Work on the current `amm-dev` branch; do not create a worktree.
- Preserve `.opencode/package-lock.json`, `.amm/`, and `portfolio.yaml`.
- Private research remains in `<workspace>/.amm/portfolio.sqlite`; Den owns no local copy.
- Portfolio `Project(kind="research")` is the only research-project identity.
- Writes are idempotent; snapshots, observations, evaluations, and decisions are append-only.
- Use canonical JSON plus SHA-256 digests; never SQLite floating point for canonical values.
- Keep provider collection and scoring algorithms outside the generic repository.

---

### Task 1: SQLite v2 and typed research repository

**Files:**
- Create: `packages/amm-portfolio/src/research-types.ts`
- Create: `packages/amm-portfolio/src/research-repository.test.ts`
- Modify: `packages/amm-portfolio/src/schema.ts`
- Modify: `packages/amm-portfolio/src/repository.ts`
- Modify: `packages/amm-portfolio/src/index.ts`

**Interfaces:**
- Produces `CreateResearchRunInput`, `SealResearchSnapshotInput`, `RecordResearchEvaluationInput`, `RecordResearchDecisionInput`, and returned entity types.
- Adds repository methods `createResearchRun`, `completeResearchRun`, `getResearchHistory`, `sealResearchSnapshot`, `listResearchObservations`, `recordResearchEvaluation`, and `recordResearchDecision`.

- [ ] Write repository tests that create a `kind=research` project, preserve two dated snapshots for one metric, append evaluation/decision history, reject non-research projects, and migrate a real v1 fixture.
- [ ] Run `pnpm --filter @openwork/amm-portfolio test -- research-repository.test.ts` and verify failure from missing methods.
- [ ] Implement schema-v2 migration, canonical JSON/digests, transactions, idempotency, and repository methods.
- [ ] Run package tests and typecheck; commit the repository slice.

### Task 2: Authenticated local research API

**Files:**
- Create: `apps/server/src/portfolio-research-routes.e2e.test.ts`
- Modify: `apps/server/src/routes/portfolio.ts`

**Interfaces:**
- Consumes Task 1 repository types and methods.
- Produces workspace-scoped `/portfolio/projects/:projectId/research/*` routes for history, runs, snapshots, observations, evaluations, and decisions.

- [ ] Write an E2E test proving authentication, workspace isolation, a complete run→snapshot→evaluation→decision flow, and observation filters.
- [ ] Run it and verify 404 failures for absent routes.
- [ ] Add strict request parsing, collaborator/write checks, repository cleanup, pagination limits, and stable error mapping.
- [ ] Run server route tests and typecheck; commit the API slice.

### Task 3: OpenCode research affordances

**Files:**
- Modify: `apps/server/src/opencode-plugins/openwork-provider-adapters.ts`
- Modify: `apps/server/src/opencode-plugins/openwork-provider-adapters.test.ts`
- Modify: `apps/server/src/opencode-plugins/openwork-extensions-preview.ts`
- Modify: `apps/server/src/opencode-plugins/openwork-extensions-preview.test.ts`

**Interfaces:**
- Produces `portfolio.research.inspect`, `.run.create`, `.run.complete`, `.snapshot.seal`, `.observations.list`, `.evaluation.record`, and `.decision.record`.

- [ ] Add failing provider-discovery and authenticated dispatch tests.
- [ ] Run focused tests and verify failures from absent affordances.
- [ ] Implement query/execute dispatch through the existing local server token and current-workspace resolver.
- [ ] Run focused tests, server typecheck, and plugin build; commit the agent slice.

### Task 4: Renderer client and shared research-history UI

**Files:**
- Modify: `apps/app/src/app/lib/openwork-server.ts`
- Create: `apps/app/src/react-app/domains/portfolio/research-history.tsx`
- Create: `apps/app/tests/portfolio-research-history.test.tsx`
- Modify: `apps/app/src/react-app/domains/portfolio/portfolio-page.tsx`

**Interfaces:**
- Adds typed client methods to fetch project research history.
- Adds a read-oriented history panel showing runs, snapshots, observations, evaluations, and decisions for a selected research project.

- [ ] Write failing client and rendered-history tests using two timestamped observations.
- [ ] Run focused tests and verify missing client/component failures.
- [ ] Implement the typed client, project selection, and history surface with accessible labels and empty/error states.
- [ ] Run focused app tests, typecheck, and build; commit the UI slice.

### Task 5: Proof and documentation

**Files:**
- Modify: `evals/specs/local-portfolio-workspace.slow.test.ts`
- Modify: `amm-docs/PORTFOLIO.md`

**Interfaces:**
- Produces app-driving proof of two snapshots in one workspace and isolation from a second workspace.

- [ ] Extend the testkit spec to create a research project and observe its history UI.
- [ ] Update current documentation with the schema, API, agent affordances, usage examples, and boundary with the KDP corpus.
- [ ] Run all focused repository/server/app tests, typechecks, builds, and `git diff --check`.
- [ ] Commit proof and docs, then report any environment-gated eval separately.
