# Local Portfolio Workspace Design

Status: approved
Date: 2026-08-16
Owner: AI Money Magic fork

## 1. Decision

Add one reusable, local-first portfolio experience to the OpenWork desktop fork. An OpenWork workspace is one portfolio. A portfolio may contain projects from multiple verticals, including publishing, music, video, and short drama. The portfolio repository and UI use generic lifecycle concepts; vertical packages contribute templates, labels, metadata, validations, and actions without creating separate databases or top-level portfolio applications.

The first implementation slice provides the shared repository, local server API, workspace detection, project hierarchy, project relationships, lifecycle stages, session context, artifact registration, and a native Portfolio overview. It does not implement every future release, publication, campaign, evidence, cost, or outcome workflow.

## 2. Goals

- Keep private portfolio state canonical on the user's computer.
- Make a workspace portable with its portfolio database and artifact files.
- Reuse one storage contract and one UI across verticals.
- Preserve OpenCode as the authority for sessions and messages.
- Preserve the workspace filesystem as the authority for artifact bytes.
- Keep the fork delta isolated behind narrow server and UI registrations.
- Allow mixed-media portfolios and cross-project lineage.

## 3. Domain hierarchy

```text
Workspace = Portfolio
Portfolio
├── Project
│   └── optional child Project
├── Project relationships
├── Session contexts
└── Registered artifacts
```

Projects support at most two containment levels in version 1. A top-level project may contain child projects; child projects may not contain more projects.

Examples:

- a book series containing book projects;
- an album containing track projects;
- a short-drama series containing episode projects; and
- a standalone video or book with no children.

Containment controls navigation. Separate directed relationships express `adaptation-of`, `derived-from`, `promotion-for`, `companion-to`, and `supersedes` without abusing containment.

## 4. Shared lifecycle

Every project uses the same top-level lifecycle:

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

Vertical extensions may store vertical-specific metadata and sub-state, but cannot replace the shared lifecycle. This allows common dashboards, filtering, automation, and reporting.

## 5. Local storage

Each initialized portfolio workspace contains:

```text
<workspace-root>/
  portfolio.yaml
  .amm/
    portfolio.sqlite
  catalog/
  projects/
    <project-id>/
      project.yaml
      00-inbox/
      10-research/
      20-planning/
      30-creation/
      40-review/
      50-release/
      60-publication/
      70-promotion/
      80-measurement/
      90-archive/
```

`portfolio.yaml` is lightweight, human-readable discovery metadata. SQLite is authoritative for identity, relationships, lifecycle state, revisions, and registered artifact metadata. Artifact bytes remain ordinary files under the workspace or another explicitly granted adopted root.

The database is separate from OpenWork's `runtime.sqlite`. OpenWork runtime upgrades therefore do not own portfolio migrations, and the portfolio remains portable with the workspace.

### 5.1 Initial tables

- `portfolio_metadata`: singleton identity, schema version, name, default vertical, timestamps and revision.
- `projects`: generic project identity, optional parent, kind, vertical, lifecycle stage, metadata JSON, timestamps and revision.
- `project_relationships`: directed typed relationships between projects.
- `session_contexts`: references an OpenCode session and optional project plus lifecycle purpose.
- `artifacts`: stable identity and optional project/session association.
- `artifact_versions`: relative path, MIME type, size, hash, provenance and approval state.
- `operation_journal`: durable recovery state for filesystem-plus-database mutations.
- `outbox_events`: durable local events for optional future synchronization.

All public IDs use lowercase UUIDv7-compatible identifiers. Writes use transactions, expected revisions where records are mutable, and idempotency keys for multi-step operations.

## 6. Local server boundary

The OpenWork local server exposes workspace-scoped endpoints under `/workspace/:id/portfolio`.

Initial endpoints:

```text
GET    /workspace/:id/portfolio
POST   /workspace/:id/portfolio/initialize
GET    /workspace/:id/portfolio/projects
POST   /workspace/:id/portfolio/projects
PATCH  /workspace/:id/portfolio/projects/:projectId
POST   /workspace/:id/portfolio/relationships
GET    /workspace/:id/portfolio/sessions/:sessionId/context
PUT    /workspace/:id/portfolio/sessions/:sessionId/context
GET    /workspace/:id/portfolio/artifacts
POST   /workspace/:id/portfolio/artifacts/register
```

The server resolves the workspace and passes only its authorized absolute root to the portfolio package. Clients never select an arbitrary database path. Mutations require the existing collaborator scope and respect read-only workspaces.

The generic portfolio package does not depend on React, Electron, Den, or OpenCode.

## 7. Desktop UI

Initialized portfolio workspaces receive one native Portfolio route. The initial page contains:

- portfolio name and optional default vertical;
- counts by lifecycle stage and vertical;
- a searchable project list/tree;
- creation of top-level and child projects;
- project lifecycle updates;
- recent registered artifacts; and
- links to associated OpenCode sessions where available.

One reusable page serves every vertical. Vertical contributions may add templates, icons, labels, metadata fields, detail sections, validators, and actions through a registry. They do not create separate portfolio storage or duplicate top-level navigation.

An uninitialized workspace shows an explicit “Create portfolio” action and does not create files merely by being viewed.

## 8. Sessions and artifacts

OpenCode remains authoritative for sessions, messages, todos, and model/tool history. The portfolio stores only contextual references such as project, lifecycle stage, vertical package, and purpose.

The existing artifact panel continues deriving generic file targets from the transcript. Registered portfolio artifacts form a second source. When both sources resolve the same relative path, registered portfolio metadata is authoritative for identity, role, version, approval, and integrity; the filesystem remains authoritative for content.

The first slice registers and lists artifacts but does not replace the existing artifact preview implementation.

## 9. Fork isolation

Implementation is isolated in new modules:

```text
packages/amm-portfolio/
apps/server/src/portfolio/
apps/app/src/react-app/domains/portfolio/
```

Existing OpenWork files receive only narrow registrations for:

- server routes;
- local client methods;
- workspace navigation/route contribution; and
- optional registered-artifact composition.

No portfolio tables are added to `runtime.sqlite`, no portfolio state is written to Den, and no OpenCode persistence format is modified. All fork changes are committed on `amm-dev`; `dev` remains a clean upstream mirror.

## 10. Failure and recovery behavior

- Viewing an ordinary workspace never creates a portfolio repository.
- Initialization fails without leaving a partially advertised portfolio.
- Unsupported schema versions fail closed with an upgrade diagnostic.
- Invalid containment depth, cycles, duplicate relationships, and missing project references are rejected deterministically.
- Filesystem/database operations use an operation journal and temporary paths.
- Artifact registration rejects paths outside the workspace or an explicit adopted root.
- Missing or changed registered files are reported as integrity diagnostics; hashes are never silently replaced after approval.
- Database corruption returns a stable diagnostic and does not fall back to an empty portfolio.

## 11. Verification

Repository tests cover migrations, initialization, hierarchy depth, relationships, lifecycle transitions, session contexts, artifact path containment, revisions, idempotency, and recovery.

Server tests prove authorization, workspace isolation, read-only behavior, endpoint contracts, and that reads do not initialize storage.

The product proof path is an `evals/specs/**/*.slow.test.ts` testkit spec that initializes a portfolio from the desktop, creates mixed-vertical projects and a child project, changes lifecycle stage, reloads the app, and observes the same state from the local repository.

## 12. Deferred work

- Full generic CRUD and dedicated pages for variants, releases, publications, campaigns, experiments, evidence, decisions, costs, and outcomes.
- Legacy portfolio adoption and external adopted roots.
- Backup, restore, relocation, export, and integrity repair UI.
- Vertical-specific contribution packages.
- Cloud dispatch, synchronization, collaboration, or backup.
- Rich portfolio artifact badges in the existing session artifact panel.
