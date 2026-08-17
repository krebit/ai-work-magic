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
PRAGMA user_version = 1;
`;
