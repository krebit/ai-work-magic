export const PORTFOLIO_SCHEMA = `
CREATE TABLE IF NOT EXISTS portfolio (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_vertical TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  parent_project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  vertical TEXT NOT NULL,
  lifecycle_stage TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  source_project_id TEXT NOT NULL REFERENCES projects(id),
  target_project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_project_id, target_project_id, type)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  resource_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_contexts (
  session_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  project_id TEXT REFERENCES projects(id),
  session_id TEXT,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(artifact_id, version),
  UNIQUE(artifact_id, sha256)
);
CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), research_type TEXT NOT NULL,
  status TEXT NOT NULL, trigger TEXT NOT NULL, request_payload_json TEXT NOT NULL, request_digest TEXT NOT NULL,
  started_at TEXT NOT NULL, completed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_snapshots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), run_id TEXT NOT NULL REFERENCES research_runs(id),
  sequence INTEGER NOT NULL, state TEXT NOT NULL, captured_at TEXT NOT NULL, sealed_at TEXT NOT NULL,
  supersedes_snapshot_id TEXT REFERENCES research_snapshots(id), canonical_payload_json TEXT NOT NULL,
  canonical_payload_digest TEXT NOT NULL, diagnostic_summary_json TEXT NOT NULL, UNIQUE(project_id, sequence)
);
CREATE TABLE IF NOT EXISTS research_observations (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES research_snapshots(id), subject_type TEXT NOT NULL,
  subject_key TEXT NOT NULL, metric TEXT NOT NULL, value_type TEXT NOT NULL, canonical_value_json TEXT NOT NULL,
  unit TEXT, provider TEXT, provider_version TEXT, observed_at TEXT NOT NULL, evidence_refs_json TEXT NOT NULL,
  observation_digest TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS research_observation_lookup ON research_observations(subject_type, subject_key, metric, observed_at);
CREATE TABLE IF NOT EXISTS research_evaluations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), snapshot_id TEXT NOT NULL REFERENCES research_snapshots(id),
  evaluation_type TEXT NOT NULL, policy_ref TEXT NOT NULL, engine_ref TEXT, evaluation_as_of TEXT NOT NULL,
  request_payload_json TEXT NOT NULL, request_digest TEXT NOT NULL, result_payload_json TEXT NOT NULL,
  result_digest TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_decisions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), evaluation_id TEXT REFERENCES research_evaluations(id),
  decision TEXT NOT NULL, rationale TEXT NOT NULL, selected_subject_refs_json TEXT NOT NULL,
  requested_follow_up_json TEXT NOT NULL, actor_ref TEXT NOT NULL, decided_at TEXT NOT NULL,
  supersedes_decision_id TEXT REFERENCES research_decisions(id)
);
PRAGMA user_version = 2;
`;
