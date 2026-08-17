# Fork Maintenance

Keep `dev` as a clean mirror of the official OpenWork `upstream/dev` branch.
Make and commit AI Money Magic changes only on `amm-dev`.

## Sync With OpenWork

Run the following commands to update the fork and replay the AI Money Magic
changes on top of the latest OpenWork code:

```bash
git fetch upstream

git switch dev
git merge --ff-only upstream/dev
git push origin dev

git switch amm-dev
git rebase dev
git push --force-with-lease origin amm-dev
```

If the rebase reports conflicts, resolve them on `amm-dev`. Do not add
fork-specific changes to `dev`.

## AMM Portfolio Integration

Portfolio is structured as a fork-owned package with thin adapters into
upstream-owned surfaces. Preserve that direction during rebases:

```text
@openwork/amm-portfolio
        ↓
local server route
        ├── renderer client ── Portfolio UI
        └── OpenCode semantic affordances
```

### Fork-owned files

These should normally replay without upstream conflicts and remain the source
of truth for Portfolio behavior:

- `packages/amm-portfolio/**` owns `<workspace>/.amm/portfolio.sqlite` and
  `portfolio.yaml`. This includes generic projects, hierarchy, relationships,
  session context, artifact versions, and append-only research runs,
  snapshots, observations, pinned evidence, evaluations, and decisions.
- `apps/server/src/routes/portfolio.ts` owns the authenticated,
  workspace-scoped local REST contract.
- `apps/app/src/react-app/domains/portfolio/**` owns the reusable Portfolio UI,
  workspace selector, and research-history view.
- `amm-docs/PORTFOLIO.md` documents the implemented contract. The matching
  design and implementation plan live under `docs/superpowers/`.
- Portfolio-focused unit, route, renderer, and testkit specs remain beside
  their respective surfaces.

Do not fold these implementations into large upstream files merely to resolve
a rebase. Keep the package, route module, and UI domain independently owned.

### Narrow upstream integration points

These files are likely conflict hotspots because OpenWork also changes them:

- `pnpm-lock.yaml` and `apps/server/package.json` wire in
  `@openwork/amm-portfolio`. Regenerate the lockfile with `pnpm`; never
  hand-merge package snapshots blindly.
- `apps/server/src/server.ts` imports and calls `registerPortfolioRoutes`.
  Preserve the current upstream server structure and re-add only that narrow
  registration.
- `apps/app/src/app/lib/openwork-server.ts` contains Portfolio DTOs and client
  methods. Keep them grouped and workspace-scoped if upstream refactors the
  client factory.
- `apps/app/src/react-app/shell/app-root.tsx`, `session-route.tsx`,
  `workspace-routes.ts`, and `domains/session/sidebar/app-sidebar.tsx` expose
  `/workspace/:workspaceId/portfolio`, select its workspace, and add the
  sidebar destination. Resolve these in favor of the new upstream shell
  architecture, then port the smallest equivalent Portfolio hooks.
- `apps/server/src/opencode-plugins/openwork-provider-adapters.ts` and
  `openwork-extensions-preview.ts` expose `portfolio.*` and
  `portfolio.research.*` through the existing three semantic OpenCode tools.
  Preserve upstream tool plumbing and re-add Portfolio as one built-in feature
  contribution and one authenticated local-server dispatcher.

Portfolio must not create a parallel router, auth mechanism, workspace store,
agent tool protocol, or application shell. It consumes the corresponding
OpenWork extension points.

### Recommended rebase resolution order

Resolve and verify Portfolio in dependency order:

1. Replay `packages/amm-portfolio` and its tests.
2. Restore the package dependency and local server route registration.
3. Restore the renderer client methods.
4. Port the Portfolio domain UI into the current upstream route/sidebar shell.
5. Restore the OpenCode provider catalog and authenticated dispatch.
6. Restore documentation and the app-driving spec.
7. Regenerate `pnpm-lock.yaml`, build the server and renderer, then run the
   focused verification commands from `amm-docs/PORTFOLIO.md`.

When a conflict spans layers, do not resolve all files at once. Get the
portable package green first, then the server, then each consumer. This makes
upstream API changes visible at the adapter that must absorb them.

### Invariants to preserve

- One OpenWork workspace owns exactly one local Portfolio.
- Existing `Project` remains the identity for books, editions, series, music,
  video, short dramas, research, and future verticals.
- Research projects use `kind=research`; do not introduce a second local
  research-project identity.
- Private Portfolio and research state stays in
  `<workspace>/.amm/portfolio.sqlite`. Den may own hosted inference, billing,
  quotas, and a global corpus, but it does not silently become canonical for
  the user's local copy.
- Workspace files remain artifact bytes; Portfolio pins metadata and exact
  artifact versions. OpenCode remains authoritative for conversation content.
- UI and OpenCode chat both use the authenticated local server contract. Do
  not implement separate persistence paths for either consumer.
- Preserve SQLite migrations and `PRAGMA user_version`; never replace a user's
  database during a rebase.

The product proof is `evals/specs/local-portfolio-workspace.slow.test.ts`. A
skipped or environment-blocked desktop run is not a pass; still run package,
route, renderer, typecheck, and build verification while reporting the testkit
lane separately.
