# Local Portfolio Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-local, mixed-vertical portfolio repository and a native desktop Portfolio page for creating and managing generic projects.

**Architecture:** A new `@openwork/amm-portfolio` package owns the portable SQLite schema and repository. The local OpenWork server resolves workspace roots and exposes authenticated portfolio routes; the React application consumes those routes through the existing OpenWork client and renders a workspace-scoped Portfolio route. OpenCode sessions and workspace files remain authoritative for conversations and artifact bytes.

**Tech Stack:** TypeScript, better-sqlite3, Zod, Bun test, Hono-style OpenWork route registry, React 19, TanStack Query, Tailwind/shadcn, OpenWork testkit.

## Global Constraints

- Work and commit only on the current `amm-dev` branch; never create a git worktree.
- Keep `dev` an exact `upstream/dev` mirror.
- Use pnpm only.
- Use TDD: each production behavior begins with a test that is observed failing for the intended reason.
- Do not use `any`, typecasts, or `as` unless required at an external boundary and justified locally.
- One OpenWork workspace is one Portfolio; projects support at most one child level.
- Shared lifecycle values are exactly `research`, `planning`, `creation`, `review`, `release`, `publication`, `promotion`, `measurement`, and `archived`.
- Initial relationship values are exactly `adaptation-of`, `derived-from`, `promotion-for`, `companion-to`, and `supersedes`.
- Store portfolio state in `<workspace>/.amm/portfolio.sqlite`, not OpenWork `runtime.sqlite` or Den.
- Merely reading an uninitialized workspace must not create `portfolio.yaml`, `.amm`, or a database.
- The runtime proof path is `evals/specs/**/*.slow.test.ts` with `@openwork/testkit`.

---

### Task 1: Portable portfolio repository and project hierarchy

**Files:**
- Create: `packages/amm-portfolio/package.json`
- Create: `packages/amm-portfolio/tsconfig.json`
- Create: `packages/amm-portfolio/src/types.ts`
- Create: `packages/amm-portfolio/src/errors.ts`
- Create: `packages/amm-portfolio/src/ids.ts`
- Create: `packages/amm-portfolio/src/schema.ts`
- Create: `packages/amm-portfolio/src/repository.ts`
- Create: `packages/amm-portfolio/src/index.ts`
- Test: `packages/amm-portfolio/src/repository.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `inspectPortfolio(root): PortfolioInspection`, `initializePortfolio(root, input): PortfolioSnapshot`, and `openPortfolioRepository(root): PortfolioRepository`.
- Produces repository methods `getSnapshot()`, `listProjects()`, `createProject(input)`, `updateProject(id, input)`, and `createRelationship(input)`.
- Produces shared types consumed by server and app: `PortfolioSnapshot`, `PortfolioProject`, `PortfolioRelationship`, `PortfolioLifecycleStage`, and request input types.

- [ ] **Step 1: Write failing repository initialization tests**

Create real temporary workspaces and assert that inspection is side-effect free, initialization creates `portfolio.yaml` plus `.amm/portfolio.sqlite`, and reopening returns the same literal portfolio identity and name.

```ts
test("inspection does not initialize an ordinary workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "amm-portfolio-"));
  expect(inspectPortfolio(root)).toEqual({ state: "uninitialized" });
  expect(existsSync(join(root, ".amm"))).toBe(false);
});

test("initialization persists one portable portfolio", async () => {
  const root = await mkdtemp(join(tmpdir(), "amm-portfolio-"));
  const initialized = initializePortfolio(root, { name: "Storyworld Studio", defaultVertical: "publishing" });
  expect(initialized.portfolio.name).toBe("Storyworld Studio");
  expect(existsSync(join(root, "portfolio.yaml"))).toBe(true);
  expect(openPortfolioRepository(root).getSnapshot().portfolio.id).toBe(initialized.portfolio.id);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm --filter @openwork/amm-portfolio test`

Expected: FAIL because the package/repository exports do not exist.

- [ ] **Step 3: Implement package, schema migration, safe inspection and initialization**

Use `better-sqlite3` with WAL mode, foreign keys enabled, and an explicit schema version. Write `portfolio.yaml` through a sibling temporary file followed by rename. If initialization fails after creating new state, remove only files created by that attempt. Never delete a pre-existing user file.

Define the exact shared values as readonly tuples and Zod enums. Validate names as trimmed non-empty strings up to 200 characters and vertical/kind identifiers as trimmed strings up to 100 characters.

- [ ] **Step 4: Run initialization tests and verify GREEN**

Run: `pnpm --filter @openwork/amm-portfolio test`

Expected: PASS.

- [ ] **Step 5: Write failing hierarchy, lifecycle and relationship tests**

Cover mixed verticals, a top-level project plus one child, rejection of a grandchild, rejection of a parent cycle, optimistic revision conflict, valid lifecycle changes, missing relationship targets, self-relationships, and duplicate directed relationships.

```ts
const series = repository.createProject({
  idempotencyKey: "series-1",
  title: "Moon Harbor",
  kind: "series",
  vertical: "short-drama",
  lifecycleStage: "planning",
});
const episode = repository.createProject({
  idempotencyKey: "episode-1",
  parentProjectId: series.id,
  title: "Episode One",
  kind: "episode",
  vertical: "short-drama",
  lifecycleStage: "creation",
});
expect(() => repository.createProject({
  idempotencyKey: "scene-1",
  parentProjectId: episode.id,
  title: "Scene One",
  kind: "scene",
  vertical: "short-drama",
  lifecycleStage: "creation",
})).toThrow("project_depth_exceeded");
```

- [ ] **Step 6: Run focused tests and verify RED**

Run: `pnpm --filter @openwork/amm-portfolio test -- --test-name-pattern "project|relationship|revision"`

Expected: FAIL because project operations are not implemented.

- [ ] **Step 7: Implement minimal project and relationship operations**

Use database constraints plus repository validation. Idempotent create retries return the original record when the key and normalized request digest match; reuse with different input throws `idempotency_conflict`. Updates require `expectedRevision`, increment revision by one, and return `revision_conflict` when stale.

- [ ] **Step 8: Run package tests and typecheck**

Run: `pnpm --filter @openwork/amm-portfolio test && pnpm --filter @openwork/amm-portfolio typecheck`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add packages/amm-portfolio pnpm-lock.yaml
git commit -m "feat(portfolio): add local project repository"
```

### Task 2: Session context and registered artifact repository

**Files:**
- Modify: `packages/amm-portfolio/src/types.ts`
- Modify: `packages/amm-portfolio/src/schema.ts`
- Modify: `packages/amm-portfolio/src/repository.ts`
- Modify: `packages/amm-portfolio/src/index.ts`
- Test: `packages/amm-portfolio/src/session-artifacts.test.ts`

**Interfaces:**
- Consumes: `PortfolioRepository` and project identities from Task 1.
- Produces: `getSessionContext(sessionId)`, `putSessionContext(sessionId, input)`, `listArtifacts(filters)`, and `registerArtifact(input)`.
- Produces types `PortfolioSessionContext`, `PortfolioArtifact`, and `PortfolioArtifactVersion`.

- [ ] **Step 1: Write failing session-context tests**

Prove portfolio-wide context with no project, project-scoped context, replacement by the same session ID, and rejection of a missing project.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @openwork/amm-portfolio test -- session-artifacts.test.ts`

Expected: FAIL because the methods do not exist.

- [ ] **Step 3: Implement session context persistence**

Store only OpenCode session references and portfolio context. Do not copy messages or todos.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter @openwork/amm-portfolio test -- session-artifacts.test.ts`

Expected: session tests PASS.

- [ ] **Step 5: Write failing artifact registration tests**

Use real files. Prove relative paths are normalized, traversal and absolute paths are rejected, file size/hash/MIME metadata is stored, repeated identical registration is idempotent, changed bytes produce a new version, and approved versions do not silently replace their checksum.

- [ ] **Step 6: Run focused tests and verify RED**

Run: `pnpm --filter @openwork/amm-portfolio test -- session-artifacts.test.ts`

Expected: artifact tests FAIL because registration is missing.

- [ ] **Step 7: Implement artifact registration and listing**

Resolve and verify paths against the workspace root, reject symlink escape, stream SHA-256, and store artifact identity separately from immutable versions. Filter lists by optional project ID and session ID.

- [ ] **Step 8: Run package verification**

Run: `pnpm --filter @openwork/amm-portfolio test && pnpm --filter @openwork/amm-portfolio typecheck`

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add packages/amm-portfolio
git commit -m "feat(portfolio): track session context and artifacts"
```

### Task 3: Authenticated local portfolio API

**Files:**
- Create: `apps/server/src/routes/portfolio.ts`
- Create: `apps/server/src/portfolio-routes.e2e.test.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes all repository methods from Tasks 1 and 2.
- Produces the endpoint contract in design section 6.
- Returns `GET /workspace/:id/portfolio` as `{ state: "uninitialized" }` or `{ state: "ready", snapshot }`.

- [ ] **Step 1: Write failing real-server tests for inspection and initialization**

Start the actual OpenWork server fixture with a temporary workspace. Prove unauthenticated access fails, authenticated inspection does not create `.amm`, initialization requires collaborator scope, and initialization persists across server restart.

- [ ] **Step 2: Run server test and verify RED**

Run: `pnpm --filter openwork-server test src/portfolio-routes.e2e.test.ts`

Expected: FAIL with route not found.

- [ ] **Step 3: Register portfolio routes and initialization mapping**

Follow `routes/sessions.ts` composition. Resolve workspaces with the existing resolver, call `ensureWritable` plus `requireClientScope(ctx, "collaborator")` for mutations, translate `PortfolioError.code` to stable HTTP 400/404/409 responses, and close repository handles after each request.

- [ ] **Step 4: Run route tests and verify GREEN**

Run: `pnpm --filter openwork-server test src/portfolio-routes.e2e.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing CRUD endpoint tests**

Exercise project creation/list/update, hierarchy rejection, relationship creation, session context, and artifact registration using real HTTP requests and files.

- [ ] **Step 6: Run server test and verify RED**

Run: `pnpm --filter openwork-server test src/portfolio-routes.e2e.test.ts`

Expected: FAIL on the first missing CRUD route.

- [ ] **Step 7: Implement minimal CRUD route handlers**

Parse inputs with the package's exported schemas. Never expose absolute paths in successful or error responses.

- [ ] **Step 8: Run server verification**

Run: `pnpm --filter openwork-server test src/portfolio-routes.e2e.test.ts && pnpm --filter openwork-server typecheck`

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add apps/server/src/routes/portfolio.ts apps/server/src/portfolio-routes.e2e.test.ts apps/server/src/server.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): expose workspace portfolio API"
```

### Task 4: OpenWork client and reusable Portfolio UI

**Files:**
- Modify: `apps/app/src/app/lib/openwork-server.ts`
- Create: `apps/app/src/react-app/domains/portfolio/portfolio-page.tsx`
- Create: `apps/app/src/react-app/domains/portfolio/portfolio-page.test.tsx`
- Create: `apps/app/src/react-app/shell/portfolio-route.tsx`
- Modify: `apps/app/src/react-app/shell/workspace-routes.ts`
- Modify: `apps/app/src/react-app/shell/app-root.tsx`
- Modify: `apps/app/src/react-app/shell/session-route.tsx`
- Modify: `apps/app/src/i18n/locales/en.ts`

**Interfaces:**
- Consumes server responses from Task 3.
- Produces client methods `getPortfolio`, `initializePortfolio`, `listPortfolioProjects`, `createPortfolioProject`, and `updatePortfolioProject`.
- Produces route helper `workspacePortfolioRoute(workspaceId)` and route `/workspace/:workspaceId/portfolio`.

- [ ] **Step 1: Write failing client contract tests**

Add tests beside existing OpenWork client tests proving exact methods, paths, verbs and bodies against a local controlled HTTP server.

- [ ] **Step 2: Run app test and verify RED**

Run: `pnpm --filter @openwork/app test -- openwork-server`

Expected: FAIL because portfolio methods are absent.

- [ ] **Step 3: Add typed client models and methods**

Keep API types structural and aligned with package output without importing the Node-only repository package into browser code.

- [ ] **Step 4: Run client tests and verify GREEN**

Run: `pnpm --filter @openwork/app test -- openwork-server`

Expected: PASS.

- [ ] **Step 5: Write failing Portfolio page rendering tests**

Render the real page with a small in-memory client adapter. Prove the uninitialized call-to-action, initialized mixed-vertical project tree, lifecycle labels, child creation affordance, and error state.

- [ ] **Step 6: Run UI test and verify RED**

Run: `pnpm --filter @openwork/app test -- portfolio-page.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 7: Implement Portfolio page and route**

Use TanStack Query and existing shadcn components. `PortfolioRoute` resolves the current OpenWork connection and workspace endpoint using existing shell helpers, renders loading/reconnect errors, and passes a focused adapter to `PortfolioPage`. Add a Portfolio action under the active workspace navigation without changing ordinary session behavior.

- [ ] **Step 8: Run UI tests and typecheck**

Run: `pnpm --filter @openwork/app test -- portfolio-page.test.tsx && pnpm --filter @openwork/app typecheck`

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add apps/app/src/app/lib/openwork-server.ts apps/app/src/react-app/domains/portfolio apps/app/src/react-app/shell/portfolio-route.tsx apps/app/src/react-app/shell/workspace-routes.ts apps/app/src/react-app/shell/app-root.tsx apps/app/src/react-app/shell/session-route.tsx apps/app/src/i18n/locales/en.ts
git commit -m "feat(app): add reusable portfolio workspace UI"
```

### Task 5: Product proof and fork documentation

**Files:**
- Create: `evals/specs/local-portfolio-workspace.slow.test.ts`
- Modify: `FORK_MAINTENANCE.md`

**Interfaces:**
- Consumes the complete repository, server API, and UI from Tasks 1–4.
- Produces ambient testkit tape for the user-visible portfolio claims.

- [ ] **Step 1: Write the failing testkit spec**

Declare observable claims for explicit initialization, mixed vertical projects, one child project, lifecycle update, and persistence after reload. Drive the headless desktop UI and prove each claim against visible UI state after the corresponding action.

- [ ] **Step 2: Run the spec and verify RED**

Run: `pnpm exec vitest run evals/specs/local-portfolio-workspace.slow.test.ts`

Expected: FAIL at the first missing or mismatched user-visible behavior.

- [ ] **Step 3: Make only proof-required integration corrections**

Correct selectors, loading boundaries, navigation registration, or state invalidation exposed by the real app. Do not add deferred features.

- [ ] **Step 4: Run the product proof and verify GREEN**

Run: `pnpm exec vitest run evals/specs/local-portfolio-workspace.slow.test.ts`

Expected: PASS with every declared claim recorded in the tape.

- [ ] **Step 5: Document fork touchpoints**

Add the portfolio package, server route registration, workspace Portfolio route/navigation, and testkit proof to `FORK_MAINTENANCE.md` under a concise “AMM portfolio integration” subsection.

- [ ] **Step 6: Run full targeted verification**

Run:

```bash
pnpm --filter @openwork/amm-portfolio test
pnpm --filter @openwork/amm-portfolio typecheck
pnpm --filter openwork-server test src/portfolio-routes.e2e.test.ts
pnpm --filter openwork-server typecheck
pnpm --filter @openwork/app test -- portfolio-page.test.tsx
pnpm --filter @openwork/app typecheck
pnpm exec vitest run evals/specs/local-portfolio-workspace.slow.test.ts
```

Expected: every command PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add evals/specs/local-portfolio-workspace.slow.test.ts FORK_MAINTENANCE.md
git commit -m "test(portfolio): prove local workspace lifecycle"
```

### Task 6: Final review and verification

**Files:**
- Review all files changed since design commit `d509171da`.

**Interfaces:**
- Consumes the completed feature.
- Produces a clean, verified `amm-dev` branch with no unresolved review findings.

- [ ] **Step 1: Review the complete diff for scope and fork isolation**

Run: `git diff --stat d509171da..HEAD && git diff --check d509171da..HEAD`

Confirm no portfolio state entered Den or `runtime.sqlite`, no OpenCode persistence changed, and core modifications are narrow registrations.

- [ ] **Step 2: Run targeted verification from Task 5 again from a clean process**

Expected: every command PASS without relying on a previously running test server.

- [ ] **Step 3: Inspect repository status**

Run: `git status --short --branch`

Expected: clean `amm-dev` working tree ahead of or aligned with `origin/amm-dev`.
