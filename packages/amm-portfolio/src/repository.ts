import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { PortfolioError } from "./errors.js";
import { PORTFOLIO_SCHEMA } from "./schema.js";
import { createSqliteDatabase, type SqliteDatabase } from "./sqlite.js";
import type {
  CreateProjectInput,
  CreateRelationshipInput,
  InitializePortfolioInput,
  Portfolio,
  PortfolioInspection,
  PortfolioProject,
  PortfolioRelationship,
  PortfolioArtifact,
  PortfolioArtifactVersion,
  PortfolioSessionContext,
  PutSessionContextInput,
  RegisterArtifactInput,
  ArtifactFilters,
  PortfolioSnapshot,
  UpdateProjectInput,
} from "./types.js";

const manifestName = "portfolio.yaml";
const databasePath = (root: string) => join(root, ".amm", "portfolio.sqlite");

function requiredText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new PortfolioError("invalid_input", `${field} is invalid`);
  return normalized;
}

function rowProject(row: Record<string, string | number | null>): PortfolioProject {
  return {
    id: String(row.id),
    parentProjectId: row.parent_project_id === null ? null : String(row.parent_project_id),
    title: String(row.title),
    kind: String(row.kind),
    vertical: String(row.vertical),
    lifecycleStage: String(row.lifecycle_stage) as PortfolioProject["lifecycleStage"],
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class PortfolioRepository {
  constructor(private readonly database: SqliteDatabase, private readonly root: string) {}

  close(): void { this.database.close(); }

  getSnapshot(): PortfolioSnapshot {
    const row = this.database.prepare("SELECT * FROM portfolio LIMIT 1").get() as Record<string, string | null> | undefined;
    if (!row) throw new PortfolioError("portfolio_uninitialized");
    const portfolio: Portfolio = {
      id: String(row.id), name: String(row.name), defaultVertical: row.default_vertical,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
    return { portfolio, projects: this.listProjects(), relationships: this.listRelationships() };
  }

  listProjects(): PortfolioProject[] {
    const rows = this.database.prepare("SELECT * FROM projects ORDER BY created_at, id").all() as Record<string, string | number | null>[];
    return rows.map(rowProject);
  }

  private getProject(id: string): PortfolioProject | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, string | number | null> | undefined;
    return row ? rowProject(row) : null;
  }

  createProject(input: CreateProjectInput): PortfolioProject {
    const title = requiredText(input.title, "title", 200);
    const kind = requiredText(input.kind, "kind", 100);
    const vertical = requiredText(input.vertical, "vertical", 100);
    const digest = createHash("sha256").update(JSON.stringify({ ...input, title, kind, vertical })).digest("hex");
    const prior = this.database.prepare("SELECT request_digest, resource_id FROM idempotency_keys WHERE key = ?").get(input.idempotencyKey) as { request_digest: string; resource_id: string } | undefined;
    if (prior) {
      if (prior.request_digest !== digest) throw new PortfolioError("idempotency_conflict");
      const project = this.getProject(prior.resource_id);
      if (!project) throw new PortfolioError("project_not_found");
      return project;
    }
    if (input.parentProjectId) {
      const parent = this.getProject(input.parentProjectId);
      if (!parent) throw new PortfolioError("project_not_found");
      if (parent.parentProjectId) throw new PortfolioError("project_depth_exceeded");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").run(id, input.parentProjectId ?? null, title, kind, vertical, input.lifecycleStage, now, now);
      this.database.prepare("INSERT INTO idempotency_keys VALUES (?, 'create-project', ?, ?)").run(input.idempotencyKey, digest, id);
    })();
    const project = this.getProject(id);
    if (!project) throw new PortfolioError("project_not_found");
    return project;
  }

  updateProject(id: string, input: UpdateProjectInput): PortfolioProject {
    const current = this.getProject(id);
    if (!current) throw new PortfolioError("project_not_found");
    if (current.revision !== input.expectedRevision) throw new PortfolioError("revision_conflict");
    const parentId = input.parentProjectId === undefined ? current.parentProjectId : input.parentProjectId;
    if (parentId === id) throw new PortfolioError("project_cycle");
    if (parentId) {
      const parent = this.getProject(parentId);
      if (!parent) throw new PortfolioError("project_not_found");
      if (parent.parentProjectId) throw new PortfolioError("project_depth_exceeded");
      const hasChildren = this.database.prepare("SELECT 1 FROM projects WHERE parent_project_id = ? LIMIT 1").get(id);
      if (hasChildren) throw new PortfolioError("project_depth_exceeded");
    }
    const now = new Date().toISOString();
    this.database.prepare("UPDATE projects SET parent_project_id=?, title=?, kind=?, vertical=?, lifecycle_stage=?, revision=revision+1, updated_at=? WHERE id=?")
      .run(parentId, input.title === undefined ? current.title : requiredText(input.title, "title", 200), input.kind === undefined ? current.kind : requiredText(input.kind, "kind", 100), input.vertical === undefined ? current.vertical : requiredText(input.vertical, "vertical", 100), input.lifecycleStage ?? current.lifecycleStage, now, id);
    const updated = this.getProject(id);
    if (!updated) throw new PortfolioError("project_not_found");
    return updated;
  }

  listRelationships(): PortfolioRelationship[] {
    return (this.database.prepare("SELECT * FROM relationships ORDER BY created_at, id").all() as Record<string, string>[]).map((row) => ({
      id: row.id, sourceProjectId: row.source_project_id, targetProjectId: row.target_project_id,
      type: row.type as PortfolioRelationship["type"], createdAt: row.created_at,
    }));
  }

  createRelationship(input: CreateRelationshipInput): PortfolioRelationship {
    if (input.sourceProjectId === input.targetProjectId) throw new PortfolioError("relationship_self_reference");
    if (!this.getProject(input.sourceProjectId) || !this.getProject(input.targetProjectId)) throw new PortfolioError("project_not_found");
    const relationship = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
    try {
      this.database.prepare("INSERT INTO relationships VALUES (?, ?, ?, ?, ?)").run(relationship.id, relationship.sourceProjectId, relationship.targetProjectId, relationship.type, relationship.createdAt);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) throw new PortfolioError("relationship_exists");
      throw error;
    }
    return relationship;
  }

  getSessionContext(sessionId: string): PortfolioSessionContext | null {
    const row = this.database.prepare("SELECT * FROM session_contexts WHERE session_id = ?").get(sessionId) as { session_id: string; project_id: string | null; updated_at: string } | undefined;
    return row ? { sessionId: row.session_id, projectId: row.project_id, updatedAt: row.updated_at } : null;
  }

  putSessionContext(sessionId: string, input: PutSessionContextInput): PortfolioSessionContext {
    const normalizedSessionId = requiredText(sessionId, "sessionId", 200);
    if (input.projectId && !this.getProject(input.projectId)) throw new PortfolioError("project_not_found");
    const updatedAt = new Date().toISOString();
    this.database.prepare("INSERT INTO session_contexts VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET project_id=excluded.project_id, updated_at=excluded.updated_at")
      .run(normalizedSessionId, input.projectId ?? null, updatedAt);
    return { sessionId: normalizedSessionId, projectId: input.projectId ?? null, updatedAt };
  }

  private artifactVersions(artifactId: string): PortfolioArtifactVersion[] {
    const rows = this.database.prepare("SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version").all(artifactId) as Array<{ id: string; version: number; sha256: string; size: number; mime_type: string; created_at: string }>;
    return rows.map((row) => ({ id: row.id, version: row.version, sha256: row.sha256, size: row.size, mimeType: row.mime_type, createdAt: row.created_at }));
  }

  listArtifacts(filters: ArtifactFilters = {}): PortfolioArtifact[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filters.projectId) { clauses.push("project_id = ?"); values.push(filters.projectId); }
    if (filters.sessionId) { clauses.push("session_id = ?"); values.push(filters.sessionId); }
    const sql = `SELECT * FROM artifacts${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at, id`;
    const rows = this.database.prepare(sql).all(...values) as Array<{ id: string; path: string; project_id: string | null; session_id: string | null; role: string; created_at: string }>;
    return rows.map((row) => ({ id: row.id, path: row.path, projectId: row.project_id, sessionId: row.session_id, role: row.role, createdAt: row.created_at, versions: this.artifactVersions(row.id) }));
  }

  registerArtifact(input: RegisterArtifactInput): PortfolioArtifact {
    if (isAbsolute(input.path)) throw new PortfolioError("artifact_path_invalid");
    const absolute = resolve(this.root, input.path);
    const workspace = realpathSync(this.root);
    const unresolvedRelativePath = relative(workspace, absolute);
    if (!unresolvedRelativePath || unresolvedRelativePath.startsWith("..") || isAbsolute(unresolvedRelativePath)) throw new PortfolioError("artifact_path_invalid");
    let file: string;
    try { file = realpathSync(absolute); } catch { throw new PortfolioError("artifact_not_found"); }
    const relativePath = relative(workspace, file).replaceAll("\\", "/");
    if (!relativePath || relativePath.startsWith("../") || isAbsolute(relativePath)) throw new PortfolioError("artifact_path_invalid");
    if (input.projectId && !this.getProject(input.projectId)) throw new PortfolioError("project_not_found");
    const stats = statSync(file);
    if (!stats.isFile()) throw new PortfolioError("artifact_not_file");
    const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
    const now = new Date().toISOString();
    let row = this.database.prepare("SELECT * FROM artifacts WHERE path = ?").get(relativePath) as { id: string } | undefined;
    if (!row) {
      row = { id: randomUUID() };
      this.database.prepare("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)").run(row.id, relativePath, input.projectId ?? null, input.sessionId ?? null, requiredText(input.role, "role", 100), now);
    }
    const versions = this.artifactVersions(row.id);
    if (!versions.some((version) => version.sha256 === sha256)) {
      const mimeTypes: Record<string, string> = { ".json": "application/json", ".md": "text/markdown", ".txt": "text/plain", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".pdf": "application/pdf" };
      this.database.prepare("INSERT INTO artifact_versions VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), row.id, versions.length + 1, sha256, stats.size, mimeTypes[extname(relativePath).toLowerCase()] ?? "application/octet-stream", now);
    }
    const artifact = this.listArtifacts().find((candidate) => candidate.id === row.id);
    if (!artifact) throw new PortfolioError("artifact_not_found");
    return artifact;
  }
}

export function openPortfolioRepository(root: string): PortfolioRepository {
  const path = databasePath(root);
  if (!existsSync(path)) throw new PortfolioError("portfolio_uninitialized");
  const database = createSqliteDatabase(path);
  database.exec("PRAGMA foreign_keys = ON");
  return new PortfolioRepository(database, root);
}

export function inspectPortfolio(root: string): PortfolioInspection {
  if (!existsSync(join(root, manifestName)) || !existsSync(databasePath(root))) return { state: "uninitialized" };
  const repository = openPortfolioRepository(root);
  try { return { state: "ready", snapshot: repository.getSnapshot() }; }
  finally { repository.close(); }
}

export function initializePortfolio(root: string, input: InitializePortfolioInput): PortfolioSnapshot {
  const inspected = inspectPortfolio(root);
  if (inspected.state === "ready") return inspected.snapshot;
  const name = requiredText(input.name, "name", 200);
  const defaultVertical = input.defaultVertical === undefined ? null : requiredText(input.defaultVertical, "defaultVertical", 100);
  const amm = join(root, ".amm");
  const manifest = join(root, manifestName);
  const temporaryManifest = `${manifest}.${randomUUID()}.tmp`;
  mkdirSync(amm, { recursive: true });
  const database = createSqliteDatabase(databasePath(root));
  let databaseOpen = true;
  try {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(PORTFOLIO_SCHEMA);
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare("INSERT INTO portfolio VALUES (?, ?, ?, ?, ?)").run(id, name, defaultVertical, now, now);
    writeFileSync(temporaryManifest, stringify({ version: 1, portfolio: { id, name, defaultVertical } }), { flag: "wx" });
    renameSync(temporaryManifest, manifest);
    return new PortfolioRepository(database, root).getSnapshot();
  } catch (error) {
    database.close();
    databaseOpen = false;
    rmSync(temporaryManifest, { force: true });
    rmSync(databasePath(root), { force: true });
    throw error;
  } finally {
    if (databaseOpen) database.close();
  }
}
