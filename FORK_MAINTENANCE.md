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

The reusable local Portfolio feature is intentionally isolated behind four
fork touchpoints:

- `packages/amm-portfolio` owns `<workspace>/.amm/portfolio.sqlite` and
  `portfolio.yaml`, including project hierarchy, relationships, session
  context, and registered artifact versions.
- `apps/server/src/routes/portfolio.ts` registers authenticated local server
  routes; `apps/server/src/server.ts` contains the narrow route registration.
- The desktop route `/workspace/:workspaceId/portfolio` and its sidebar entry
  render `domains/portfolio/portfolio-page.tsx` inside the existing session
  shell.
- `evals/specs/local-portfolio-workspace.slow.test.ts` is the product proof for
  initialization, mixed verticals, child projects, lifecycle, and persistence.

Do not move this state into Den, the shared OpenWork `runtime.sqlite`, or
OpenCode session storage during upstream rebases. Workspace files remain the
artifact bytes and OpenCode remains the conversation source of truth.
