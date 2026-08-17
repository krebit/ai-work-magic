import {
  initializePortfolio,
  inspectPortfolio,
  openPortfolioRepository,
  PortfolioError,
  PORTFOLIO_LIFECYCLE_STAGES,
  PORTFOLIO_RELATIONSHIP_TYPES,
  type PortfolioLifecycleStage,
  type PortfolioRelationshipType,
} from "@openwork/amm-portfolio";
import { ApiError } from "../errors.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

interface RegisterPortfolioRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  resolveWorkspaceWithoutBootstrap: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

function stringField(body: Record<string, unknown>, key: string, optional = false): string | undefined {
  const value = body[key];
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "invalid_payload", `${key} is required`);
  return value.trim();
}

function numberField(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (!Number.isInteger(value) || Number(value) < 1) throw new ApiError(400, "invalid_payload", `${key} must be a positive integer`);
  return Number(value);
}

function lifecycle(value: string | undefined): PortfolioLifecycleStage {
  const stage = PORTFOLIO_LIFECYCLE_STAGES.find((candidate) => candidate === value);
  if (!stage) throw new ApiError(400, "invalid_payload", "lifecycleStage is invalid");
  return stage;
}

function relationshipType(value: string | undefined): PortfolioRelationshipType {
  const type = PORTFOLIO_RELATIONSHIP_TYPES.find((candidate) => candidate === value);
  if (!type) throw new ApiError(400, "invalid_payload", "type is invalid");
  return type;
}

function remap(error: unknown): never {
  if (!(error instanceof PortfolioError)) throw error;
  const notFound = error.code.endsWith("_not_found") || error.code === "portfolio_uninitialized";
  const conflict = error.code.includes("conflict") || error.code === "relationship_exists";
  throw new ApiError(notFound ? 404 : conflict ? 409 : 400, error.code, error.message);
}

export function registerPortfolioRoutes(options: RegisterPortfolioRoutesOptions): void {
  const { routes, config, jsonResponse, readJsonBody, ensureWritable, requireClientScope, resolveWorkspace, resolveWorkspaceWithoutBootstrap } = options;

  const mutate = (ctx: RequestContext): void => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
  };

  addRoute(routes, "GET", "/workspace/:id/portfolio", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    return jsonResponse(inspectPortfolio(workspace.path));
  });

  addRoute(routes, "POST", "/workspace/:id/portfolio", "client", async (ctx) => {
    mutate(ctx);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    try {
      const snapshot = initializePortfolio(workspace.path, { name: stringField(body, "name")!, defaultVertical: stringField(body, "defaultVertical", true) });
      return jsonResponse({ state: "ready", snapshot }, 201);
    } catch (error) { remap(error); }
  });

  addRoute(routes, "GET", "/workspace/:id/portfolio/projects", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    try {
      const repository = openPortfolioRepository(workspace.path);
      try { return jsonResponse({ items: repository.listProjects() }); } finally { repository.close(); }
    } catch (error) { remap(error); }
  });

  addRoute(routes, "POST", "/workspace/:id/portfolio/projects", "client", async (ctx) => {
    mutate(ctx);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    try {
      const repository = openPortfolioRepository(workspace.path);
      try {
        return jsonResponse(repository.createProject({ idempotencyKey: stringField(body, "idempotencyKey")!, parentProjectId: stringField(body, "parentProjectId", true), title: stringField(body, "title")!, kind: stringField(body, "kind")!, vertical: stringField(body, "vertical")!, lifecycleStage: lifecycle(stringField(body, "lifecycleStage")) }), 201);
      } finally { repository.close(); }
    } catch (error) { remap(error); }
  });

  addRoute(routes, "PATCH", "/workspace/:id/portfolio/projects/:projectId", "client", async (ctx) => {
    mutate(ctx);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    try {
      const repository = openPortfolioRepository(workspace.path);
      try {
        const lifecycleValue = stringField(body, "lifecycleStage", true);
        return jsonResponse(repository.updateProject(ctx.params.projectId, {
          expectedRevision: numberField(body, "expectedRevision"),
          title: stringField(body, "title", true), kind: stringField(body, "kind", true), vertical: stringField(body, "vertical", true),
          lifecycleStage: lifecycleValue ? lifecycle(lifecycleValue) : undefined,
          parentProjectId: stringField(body, "parentProjectId", true),
        }));
      } finally { repository.close(); }
    } catch (error) { remap(error); }
  });

  addRoute(routes, "POST", "/workspace/:id/portfolio/relationships", "client", async (ctx) => {
    mutate(ctx);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    try {
      const repository = openPortfolioRepository(workspace.path);
      try { return jsonResponse(repository.createRelationship({ sourceProjectId: stringField(body, "sourceProjectId")!, targetProjectId: stringField(body, "targetProjectId")!, type: relationshipType(stringField(body, "type")) }), 201); }
      finally { repository.close(); }
    } catch (error) { remap(error); }
  });

  addRoute(routes, "GET", "/workspace/:id/portfolio/sessions/:sessionId", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    try { const repository = openPortfolioRepository(workspace.path); try { return jsonResponse({ item: repository.getSessionContext(ctx.params.sessionId) }); } finally { repository.close(); } }
    catch (error) { remap(error); }
  });

  addRoute(routes, "PUT", "/workspace/:id/portfolio/sessions/:sessionId", "client", async (ctx) => {
    mutate(ctx);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    try { const repository = openPortfolioRepository(workspace.path); try { return jsonResponse(repository.putSessionContext(ctx.params.sessionId, { projectId: stringField(body, "projectId", true) })); } finally { repository.close(); } }
    catch (error) { remap(error); }
  });

  addRoute(routes, "GET", "/workspace/:id/portfolio/artifacts", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    try { const repository = openPortfolioRepository(workspace.path); try { return jsonResponse({ items: repository.listArtifacts({ projectId: ctx.url.searchParams.get("projectId") ?? undefined, sessionId: ctx.url.searchParams.get("sessionId") ?? undefined }) }); } finally { repository.close(); } }
    catch (error) { remap(error); }
  });

  addRoute(routes, "POST", "/workspace/:id/portfolio/artifacts", "client", async (ctx) => {
    mutate(ctx);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    try { const repository = openPortfolioRepository(workspace.path); try { return jsonResponse(repository.registerArtifact({ path: stringField(body, "path")!, role: stringField(body, "role")!, projectId: stringField(body, "projectId", true), sessionId: stringField(body, "sessionId", true) }), 201); } finally { repository.close(); } }
    catch (error) { remap(error); }
  });
}
