# Generic Portfolio Research History Design

## Status and decision

Implement a reusable, local-first research-history extension for Portfolio. The existing Portfolio `Project` is the only user-facing project identity. A research investigation is a Portfolio project whose `kind` is `research`; it is not duplicated as a separate `ResearchProject` record.

Typed research tables record immutable history beneath that project. KDP, music, video, short-drama, audience, competitor, and promotion research use the same run/snapshot/observation/evaluation/decision structure while retaining vertical-specific canonical payloads and policies.

This design supersedes only the separate local `ResearchProject` identity proposed in the older KDP repository specification. It preserves that specification's immutable snapshots, timestamped observations, evidence lineage, deterministic rescoring, append-only decisions, offline operation, and local canonical ownership.

## Scope

The first slice provides:

- Generic research projects backed by existing Portfolio projects.
- Append-only research runs.
- Immutable collection snapshots and canonical payload digests.
- Indexed, typed observations over time.
- Artifact-backed evidence references.
- Immutable evaluations and decisions.
- Typed relationships from research projects to resulting Portfolio projects.
- Local authenticated REST operations.
- OpenCode semantic affordances for chat-based creation, recording, and queries.
- A Portfolio research-history view for a selected research project.
- SQLite migration from the existing Portfolio schema without losing current projects or artifacts.

The first slice does not:

- Call market-data providers.
- Implement KDP keyword expansion, collection, or scoring algorithms.
- Synchronize private research projects to Den or the global corpus.
- Replace the separate Den-to-AMM live integration plan.
- Add cloud-canonical project storage.
- Infer business decisions automatically.
- Store provider credentials, raw secret-bearing responses, or browser sessions.

## Architecture

```text
Portfolio
└── Project(kind="research", vertical=<domain>)
    ├── sessions
    ├── artifacts
    ├── ResearchRun[]
    │   └── ResearchSnapshot[]
    │       ├── ResearchObservation[]
    │       └── ResearchEvidenceLink[] -> ArtifactVersion
    ├── ResearchEvaluation[]
    ├── ResearchDecision[]
    └── project relationship -> resulting project
```

The implementation remains inside `@openwork/amm-portfolio` because this package owns the portable workspace database and Portfolio identity graph. Research code is split into focused types, schema, and repository methods rather than expanding the generic project row or adding arbitrary JSON metadata to it.

The OpenWork local server is the only filesystem/database boundary. The renderer and OpenCode plugin use its authenticated workspace-scoped API. Den and `openwork-cloud` are not required to read or modify local research history.

## Identity and ownership

Every research record references an existing Portfolio project ID. Research operations reject projects whose normalized `kind` is not `research`.

The existing `projects.id` remains the identity used by:

- Sidebar and Portfolio UI.
- Session context.
- Artifact ownership.
- Parent/child organization.
- Cross-project relationships.
- Research history.
- Later vertical outcome links.

There is no `research_projects` table.

## Data model

### ResearchRun

One attempted or completed research workflow:

```text
id
project_id
research_type
status: planned | running | completed | partial | failed | cancelled
trigger
request_payload_json
request_digest
started_at
completed_at?
created_at
```

`research_type` is a namespaced free-form identifier such as `amazon-kdp.keyword-opportunity`, `music.genre-demand`, or `video.topic-trends`. The request payload is immutable canonical JSON. The digest is SHA-256 over that canonical payload.

### ResearchSnapshot

An immutable evidence boundary produced by one run:

```text
id
project_id
run_id
sequence
state: complete | partial | invalid
captured_at
sealed_at
supersedes_snapshot_id?
canonical_payload_json
canonical_payload_digest
diagnostic_summary_json
```

Snapshots are never updated. New evidence creates a new snapshot. Sequence is unique within a research project. A superseding snapshot must belong to the same project.

### ResearchObservation

An immutable queryable fact included in a snapshot:

```text
id
snapshot_id
subject_type
subject_key
metric
value_type: string | integer | decimal | boolean | json
canonical_value_json
unit?
provider?
provider_version?
observed_at
evidence_refs_json
observation_digest
```

The generic repository does not interpret a metric. Vertical packages own metric names and validate their canonical payload before persistence. Indexed columns support comparisons by project, research type, subject, metric, provider, and observation interval.

Decimal and money values are stored canonically as strings inside JSON, never SQLite floating-point values.

### ResearchEvidenceLink

Links a snapshot or observation to a registered Portfolio artifact version:

```text
id
snapshot_id
observation_id?
artifact_id
artifact_version_id
role
captured_at
rights_classification?
created_at
```

Evidence must already be registered as a workspace-relative Portfolio artifact. The link pins an exact artifact version, so later changes to the file do not change historical evidence identity.

### ResearchEvaluation

An immutable analysis or score over one snapshot:

```text
id
project_id
snapshot_id
evaluation_type
policy_ref
engine_ref?
evaluation_as_of
request_payload_json
request_digest
result_payload_json
result_digest
created_at
```

Rescoring creates another evaluation. The project has no mutable `latest_score` column; latest and comparative views are queries over immutable evaluations.

### ResearchDecision

An append-only human or explicitly attributed operator decision:

```text
id
project_id
evaluation_id?
decision: accept | reject | more-research
rationale
selected_subject_refs_json
requested_follow_up_json
actor_ref
decided_at
supersedes_decision_id?
```

A correction appends a decision with `supersedes_decision_id`. Existing decisions are never rewritten.

## Project relationships

Add generic relationship types:

```text
informed
validated
invalidated
produced
```

Existing relationship types remain unchanged. Examples:

```text
KDP niche research --informed--> Camping Journal Series
Audience research --validated--> Launch Campaign
Trend research --invalidated--> Short-drama Concept A
```

The relationship links projects; it does not copy research payloads into the resulting project.

## Repository operations

The portable package exposes:

```text
createResearchRun
completeResearchRun
getResearchRun
listResearchRuns

sealResearchSnapshot
getResearchSnapshot
listResearchSnapshots
compareResearchSnapshots

listResearchObservations

linkResearchEvidence

recordResearchEvaluation
listResearchEvaluations

recordResearchDecision
listResearchDecisions
```

Every write takes an idempotency key. Mutable run completion also requires its current state and rejects terminal-state rewrites. Immutable records deduplicate only when the same identity and digest agree; mismatched retries fail with a stable conflict.

All multi-row snapshot writes—snapshot, observations, evidence links, and idempotency receipt—commit in one SQLite transaction.

## Local API

Authenticated routes live below the existing workspace Portfolio boundary:

```text
GET    /workspace/:id/portfolio/projects/:projectId/research

GET    /workspace/:id/portfolio/projects/:projectId/research/runs
POST   /workspace/:id/portfolio/projects/:projectId/research/runs
PATCH  /workspace/:id/portfolio/projects/:projectId/research/runs/:runId

GET    /workspace/:id/portfolio/projects/:projectId/research/snapshots
POST   /workspace/:id/portfolio/projects/:projectId/research/snapshots
GET    /workspace/:id/portfolio/projects/:projectId/research/snapshots/:snapshotId

GET    /workspace/:id/portfolio/projects/:projectId/research/observations

POST   /workspace/:id/portfolio/projects/:projectId/research/evidence

GET    /workspace/:id/portfolio/projects/:projectId/research/evaluations
POST   /workspace/:id/portfolio/projects/:projectId/research/evaluations

GET    /workspace/:id/portfolio/projects/:projectId/research/decisions
POST   /workspace/:id/portfolio/projects/:projectId/research/decisions
```

Reads require local client authentication. Writes also require a writable workspace and `collaborator` scope. The server derives the absolute database and artifact paths from the authorized workspace ID.

List operations use bounded pagination and filters. Observation filters include snapshot, subject type/key, metric, provider, and observed interval.

## OpenCode agent integration

Portfolio discovery exposes these additional affordances:

```text
portfolio.research.inspect
portfolio.research.run.create
portfolio.research.run.complete
portfolio.research.snapshot.seal
portfolio.research.observations.list
portfolio.research.evidence.link
portfolio.research.evaluation.record
portfolio.research.decision.record
```

Reads use `openwork_query`; writes use `openwork_execute`. The plugin resolves the current workspace exactly as existing Portfolio tools do and calls the authenticated local API.

The agent must not persist a provider result directly as trusted observations unless the invoking vertical capability validates it against its versioned contract. The generic Portfolio tool accepts already canonical records and preserves their vertical schema reference and digest.

## User interface

The Portfolio overview continues to list all projects. A research project row provides a **Research history** action. Its detail surface contains:

- Current project identity and lifecycle.
- Runs ordered newest first with status and research type.
- Snapshot timeline with complete/partial/invalid state.
- Observation filters and time comparison for the same subject/metric.
- Evaluations with policy/engine identity.
- Decision history.
- Linked evidence artifacts.
- Projects informed or validated by this research.

The first slice is read-oriented. Creation remains available through agent chat and API; a future vertical package may add purpose-built research forms without replacing the shared history view.

## Migration and compatibility

The current database sets `PRAGMA user_version = 1`. Introduce an application-managed migration to version 2:

1. Open the existing database with foreign keys enabled.
2. Read `user_version`.
3. In one transaction, create research tables and indexes and extend relationship validation in application code.
4. Set `user_version = 2` only after every statement succeeds.
5. Leave all existing Portfolio, project, relationship, session, artifact, and artifact-version rows unchanged.

New initialization creates schema version 2 directly. Opening a newer unsupported schema fails with a stable diagnostic and never attempts a downgrade.

No existing artifact bytes are moved. Existing artifact-version rows can be pinned by new evidence links.

## Error behavior

Stable errors include:

```text
research_project_kind_required
research_run_not_found
research_run_terminal
research_run_state_conflict
research_snapshot_not_found
research_snapshot_invalid
research_snapshot_sequence_conflict
research_snapshot_digest_conflict
research_observation_invalid
research_evidence_version_not_found
research_evaluation_not_found
research_decision_conflict
research_supersedes_mismatch
schema_version_unsupported
```

Validation reports malformed observations before starting a transaction. A failed snapshot seal creates no snapshot, observation, evidence, or idempotency row.

## Security and privacy

- Private research history remains in `<workspace>/.amm/portfolio.sqlite`.
- Evidence bytes remain ordinary workspace files.
- Provider credentials and secret-bearing URLs are rejected from canonical records.
- Logs use opaque IDs and stable error codes, not observation payloads.
- Den receives no local research history unless a separate explicit upload operation is designed and approved.
- The global corpus is governed by its separate API-side specification and never reads the local database.

## Verification

Repository tests must prove:

- Version-1 databases migrate without changing existing rows.
- Research operations reject non-research projects.
- Multiple runs and snapshots preserve history.
- Same subject/metric observations compare correctly across timestamps.
- Snapshot sealing is atomic and immutable.
- Rescoring appends evaluations.
- Superseding decisions preserve prior decisions.
- Evidence pins an exact artifact version.
- Idempotent retries deduplicate and conflicting retries fail.
- Export/reopen returns byte-equivalent canonical payloads and digests.

Server tests must prove authentication, collaborator scope, workspace isolation, filters, pagination, and stable error mapping.

Agent tests must prove discovery, current-workspace resolution, authenticated local requests, and at least one complete run -> snapshot -> evaluation -> decision flow without Den.

The app-driving testkit spec must create two workspaces, create a research project in one, record two dated snapshots for one metric, display their history, and prove that the other workspace remains unchanged.

## Relationship to existing plans

The live KDP integration plan in `amm-docs/KDP_RESEARCH_LIVE_E2E_IMPLEMENTATION_PLAN.md` remains responsible for Den authentication, quotas, billing, calls to `ai-api-magic`, and global-corpus boundaries. Its final local persistence step should write the returned canonical collection into this generic research-history contract instead of storing only a niche brief artifact.

The authoritative current Portfolio documentation in `amm-docs/PORTFOLIO.md` must be updated when this design is implemented.
