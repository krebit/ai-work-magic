# Portfolio

## Overview

Portfolio is the reusable, local-first project system in the AI Money Magic OpenWork fork. It is intentionally generic: one Portfolio can contain publishing, music, video, short-drama, marketing, and future project types without creating separate databases or top-level applications for each vertical.

The core ownership rule is:

```text
OpenWork workspace = one local Portfolio
```

Each workspace has an independent Portfolio. Switching the workspace in the Portfolio page switches the database and projects being displayed. Merely viewing an uninitialized Portfolio does not create files.

Portfolio is implemented in this repository and maintained on the `amm-dev` fork branch. It is not part of upstream OpenWork and does not store its private local state in Den.

## User interface

Open Portfolio from the primary navigation in the left sidebar. The Portfolio header contains a **Portfolio workspace** selector that identifies the active workspace and lets the user switch between workspace Portfolios without returning to a session page.

An uninitialized workspace displays an explicit **Create portfolio** action. After initialization, the page currently supports:

- Viewing the Portfolio name.
- Creating generic top-level projects.
- Creating one level of child projects.
- Assigning a free-form project kind and vertical.
- Moving projects through lifecycle stages.
- Viewing mixed verticals in one Portfolio.
- Opening **History** on any `kind=research` project to view its longitudinal records.

The current page is an overview and creation surface. The underlying repository and agent surface also support project relationships, session context, and registered artifacts, although dedicated UI controls for all of those operations have not yet been added.

Portfolio rename, Portfolio deletion, project deletion, and arbitrary-depth project trees are not currently implemented.

## Storage model

Initializing a Portfolio creates the following workspace-local files:

```text
<workspace>/
  portfolio.yaml
  .amm/
    portfolio.sqlite
```

`portfolio.yaml` is lightweight discovery metadata. `.amm/portfolio.sqlite` is authoritative for Portfolio identity, projects, relationships, lifecycle state, session context, artifact registration, research history, revisions, and timestamps.

The database uses Better SQLite3 with foreign keys and WAL mode. It is deliberately separate from OpenWork's runtime database:

- OpenWork and OpenCode remain authoritative for sessions, messages, todos, and tool history.
- Ordinary workspace files remain authoritative for artifact bytes.
- Portfolio stores project metadata, relationships, session associations, artifact identities, and artifact versions.
- Den does not receive the local Portfolio database or workspace files.

The portable storage implementation lives in [`packages/amm-portfolio`](../packages/amm-portfolio).

## Domain model

### Portfolio and projects

A Portfolio contains generic projects. A project has:

- `id`
- optional `parentProjectId`
- `title`
- free-form `kind`
- free-form `vertical`
- `lifecycleStage`
- optimistic-concurrency `revision`
- creation and update timestamps

Examples of `kind` include `book`, `series`, `edition`, `album`, `episode`, `video`, and `campaign`. Examples of `vertical` include `publishing`, `music`, `video`, and `short-drama`.

Research uses that same identity: a project with `kind` equal to `research` and a domain-specific vertical such as `amazon-kdp`, `music`, `video`, or `marketing`. There is no separate research-project record.

Lifecycle stages are:

```text
research
planning
creation
review
release
publication
promotion
measurement
archived
```

Project updates require the current `revision`. A stale revision fails with a conflict instead of silently overwriting newer changes.

### Relationships

Projects can have cross-project relationships independent of parent/child hierarchy:

```text
adaptation-of
derived-from
promotion-for
companion-to
supersedes
informed
validated
invalidated
produced
```

This supports relationships such as a video adapting a book, a campaign promoting an album, or a new edition superseding an older edition.

### Research history

A research project owns append-only runs, immutable snapshots, typed timestamped observations, evaluations, and attributed decisions. Evidence links pin exact registered artifact versions, so later file changes cannot rewrite historical evidence. New collections and rescoring append records instead of replacing earlier results.

The schema is deliberately generic: vertical integrations own collection and scoring rules, while this repository preserves their canonical payloads and digests. Den and hosted APIs may own the global corpus, quotas, and billing; the user's private research copy stays in `<workspace>/.amm/portfolio.sqlite`.

### Session context

An OpenCode session can be associated with either:

- The workspace Portfolio generally; or
- One specific project.

Portfolio stores only the session reference and project context. It does not duplicate the conversation transcript.

### Artifacts

Portfolio can register a workspace-relative file as an artifact with:

- A role.
- An optional project.
- An optional session.
- Content hash, MIME type, size, and version history.

Registering the same path after its contents change creates another artifact version. The file itself remains an ordinary workspace file.

## Local server API

The OpenWork local server exposes authenticated, workspace-scoped routes. `:id` is an OpenWork workspace ID, not an arbitrary filesystem path.

```text
GET    /workspace/:id/portfolio
POST   /workspace/:id/portfolio

GET    /workspace/:id/portfolio/projects
POST   /workspace/:id/portfolio/projects
PATCH  /workspace/:id/portfolio/projects/:projectId

POST   /workspace/:id/portfolio/relationships

GET    /workspace/:id/portfolio/sessions/:sessionId
PUT    /workspace/:id/portfolio/sessions/:sessionId

GET    /workspace/:id/portfolio/artifacts
POST   /workspace/:id/portfolio/artifacts

GET    /workspace/:id/portfolio/projects/:projectId/research
POST   /workspace/:id/portfolio/projects/:projectId/research/runs
PATCH  /workspace/:id/portfolio/projects/:projectId/research/runs/:runId
POST   /workspace/:id/portfolio/projects/:projectId/research/snapshots
GET    /workspace/:id/portfolio/projects/:projectId/research/observations
POST   /workspace/:id/portfolio/projects/:projectId/research/evidence
POST   /workspace/:id/portfolio/projects/:projectId/research/evaluations
POST   /workspace/:id/portfolio/projects/:projectId/research/decisions
```

Reads require the normal local client authentication. Mutations additionally require a writable server and the existing `collaborator` token scope. The server resolves the workspace root internally, so a client cannot use these routes to select an arbitrary SQLite database.

An uninitialized `GET /workspace/:id/portfolio` returns:

```json
{ "state": "uninitialized" }
```

Initialization example:

```http
POST /workspace/ws_example/portfolio
Authorization: Bearer <local-server-token>
Content-Type: application/json

{
  "name": "Creator Studio",
  "defaultVertical": "publishing"
}
```

Project creation requires an idempotency key:

```json
{
  "idempotencyKey": "project-import-2026-08-17-1",
  "title": "Moon Harbor",
  "kind": "series",
  "vertical": "short-drama",
  "lifecycleStage": "research"
}
```

The route implementation is [`apps/server/src/routes/portfolio.ts`](../apps/server/src/routes/portfolio.ts).

## Agent chat integration

Portfolio is available to the OpenCode agent in the desktop chat interface.

It is **not** implemented as a Den/cloud MCP capability. Local Portfolio data belongs to the current workspace and must remain available offline, so it is exposed through OpenWork's existing built-in semantic tool layer. This layer already knows the current OpenCode directory, resolves it to an OpenWork workspace, and authenticates to the local server with `OPENWORK_SERVER_URL` and `OPENWORK_SERVER_TOKEN`.

The agent first discovers Portfolio operations through `openwork_context`, then uses:

- `openwork_query` for side-effect-free reads.
- `openwork_execute` for mutations.

Available semantic affordances are:

```text
portfolio.inspect
portfolio.initialize
portfolio.project.create
portfolio.project.update
portfolio.relationship.create
portfolio.session.get
portfolio.session.set
portfolio.artifacts.list
portfolio.artifact.register
portfolio.research.inspect
portfolio.research.run.create
portfolio.research.run.complete
portfolio.research.snapshot.seal
portfolio.research.observations.list
portfolio.research.evidence.link
portfolio.research.evaluation.record
portfolio.research.decision.record
```

If the current OpenCode directory identifies a workspace, `workspaceId` may be omitted. If the context is ambiguous, the agent must pass a workspace ID or exact workspace name.

Example requests a user can make in chat:

```text
Create a publishing Portfolio named Creator Studio in this workspace.

Add Moon Harbor as a short-drama series in research, then add Episode One as its child project.

Move Night Signals to publication. Inspect the Portfolio first so you use its current project revision.

Associate this session with the Moon Harbor project.

Register output/trailer-final.mp4 as the release-master artifact for Moon Harbor.

Show me every artifact registered to this project.

Relate the trailer project to Moon Harbor as promotion-for.

Create an amazon-kdp research project called Camping Journal Opportunity, research the niche, and preserve its run, snapshot, keyword observations, evidence, evaluation, and decision.

Compare the keyword observations over time, then relate the research to Camping Journal Series as informed.
```

The system instruction tells the agent to keep Portfolio metadata synchronized when the user asks it to create, organize, publish, promote, or track durable project work. Mutations still happen only when appropriate to the user's request; merely discussing an idea does not initialize or modify a Portfolio.

The semantic provider catalog is implemented in [`openwork-provider-adapters.ts`](../apps/server/src/opencode-plugins/openwork-provider-adapters.ts), and authenticated execution is implemented in [`openwork-extensions-preview.ts`](../apps/server/src/opencode-plugins/openwork-extensions-preview.ts).

## Why this is not in Den MCP

The two systems serve different ownership boundaries:

| Surface | Purpose | Data location |
| --- | --- | --- |
| OpenWork semantic tools | Local workspace and Portfolio operations | User's workspace |
| Den `openwork-cloud` MCP | Organization capabilities, cloud skills, connectors, and external MCPs | Den and connected services |

Moving local Portfolio operations into Den MCP would make offline local work depend on cloud authentication and would require sending or proxying local workspace state through Den. The built-in OpenWork tool uses the same local API as the UI, so UI and chat cannot develop separate Portfolio behavior.

If a future cloud worker operates on a server-hosted workspace, it can use the same local-server contract within that worker. Organization billing and cloud model usage remain Den concerns; Portfolio persistence remains workspace-scoped.

## Implementation map

```text
packages/amm-portfolio/
  Portable types, schema, migrations, repository, and tests

apps/server/src/routes/portfolio.ts
  Authenticated local REST API

apps/server/src/opencode-plugins/openwork-provider-adapters.ts
  Portfolio affordance discovery for openwork_context

apps/server/src/opencode-plugins/openwork-extensions-preview.ts
  Agent query/command dispatch to the local API

apps/app/src/app/lib/openwork-server.ts
  Typed renderer client

apps/app/src/react-app/domains/portfolio/
  Portfolio page, workspace selector, and shared research-history view

apps/app/src/react-app/shell/workspace-routes.ts
apps/app/src/react-app/shell/session-route.tsx
  Route and shell integration

evals/specs/local-portfolio-workspace.slow.test.ts
  User-visible app-driving proof
```

## Development and verification

Relevant focused commands:

```bash
pnpm --filter @openwork/amm-portfolio test
pnpm --filter @openwork/amm-portfolio typecheck

pnpm --filter openwork-server exec bun test src/portfolio-routes.e2e.test.ts
pnpm --filter openwork-server exec bun test \
  src/opencode-plugins/openwork-provider-adapters.test.ts \
  src/opencode-plugins/openwork-extensions-preview.test.ts
pnpm --filter openwork-server typecheck
pnpm --filter openwork-server build

pnpm --filter @openwork/app exec bun test \
  tests/portfolio-client.test.ts \
  tests/portfolio-navigation.test.ts \
  tests/portfolio-tree.test.ts \
  tests/portfolio-workspace-selector.test.tsx \
  tests/portfolio-research-history.test.tsx
pnpm --filter @openwork/app typecheck
```

The app-driving specification is opt-in:

```bash
OPENWORK_EVAL_APP_SPECS=1 pnpm exec vitest run \
  evals/specs/local-portfolio-workspace.slow.test.ts
```

After changing the OpenCode plugin, restart `pnpm dev`; the desktop development launcher rebuilds the server and bundled plugin before starting Electron.

## Historical design documents

The original design and execution plan remain useful historical context:

- [`docs/superpowers/specs/2026-08-16-local-portfolio-workspace-design.md`](../docs/superpowers/specs/2026-08-16-local-portfolio-workspace-design.md)
- [`docs/superpowers/plans/2026-08-16-local-portfolio-workspace.md`](../docs/superpowers/plans/2026-08-16-local-portfolio-workspace.md)
- [`docs/superpowers/specs/2026-08-17-generic-portfolio-research-history-design.md`](../docs/superpowers/specs/2026-08-17-generic-portfolio-research-history-design.md)
- [`docs/superpowers/plans/2026-08-17-generic-portfolio-research-history.md`](../docs/superpowers/plans/2026-08-17-generic-portfolio-research-history.md)

Those files describe intent and planned sequencing. This document describes the current implemented behavior and should be updated when the Portfolio contract changes.
