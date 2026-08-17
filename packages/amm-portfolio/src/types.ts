export const PORTFOLIO_LIFECYCLE_STAGES = [
  "research",
  "planning",
  "creation",
  "review",
  "release",
  "publication",
  "promotion",
  "measurement",
  "archived",
] as const;

export const PORTFOLIO_RELATIONSHIP_TYPES = [
  "adaptation-of",
  "derived-from",
  "promotion-for",
  "companion-to",
  "supersedes",
  "informed",
  "validated",
  "invalidated",
  "produced",
] as const;

export type PortfolioLifecycleStage = (typeof PORTFOLIO_LIFECYCLE_STAGES)[number];
export type PortfolioRelationshipType = (typeof PORTFOLIO_RELATIONSHIP_TYPES)[number];

export interface Portfolio {
  id: string;
  name: string;
  defaultVertical: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioProject {
  id: string;
  parentProjectId: string | null;
  title: string;
  kind: string;
  vertical: string;
  lifecycleStage: PortfolioLifecycleStage;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioRelationship {
  id: string;
  sourceProjectId: string;
  targetProjectId: string;
  type: PortfolioRelationshipType;
  createdAt: string;
}

export interface PortfolioSnapshot {
  portfolio: Portfolio;
  projects: PortfolioProject[];
  relationships: PortfolioRelationship[];
}

export type PortfolioInspection =
  | { state: "uninitialized" }
  | { state: "ready"; snapshot: PortfolioSnapshot };

export interface InitializePortfolioInput {
  name: string;
  defaultVertical?: string;
}

export interface CreateProjectInput {
  idempotencyKey: string;
  parentProjectId?: string;
  title: string;
  kind: string;
  vertical: string;
  lifecycleStage: PortfolioLifecycleStage;
}

export interface UpdateProjectInput {
  expectedRevision: number;
  parentProjectId?: string | null;
  title?: string;
  kind?: string;
  vertical?: string;
  lifecycleStage?: PortfolioLifecycleStage;
}

export interface CreateRelationshipInput {
  sourceProjectId: string;
  targetProjectId: string;
  type: PortfolioRelationshipType;
}

export interface PortfolioSessionContext {
  sessionId: string;
  projectId: string | null;
  updatedAt: string;
}

export interface PortfolioArtifactVersion {
  id: string;
  version: number;
  sha256: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface PortfolioArtifact {
  id: string;
  path: string;
  projectId: string | null;
  sessionId: string | null;
  role: string;
  createdAt: string;
  versions: PortfolioArtifactVersion[];
}

export interface PutSessionContextInput { projectId?: string }
export interface RegisterArtifactInput {
  path: string;
  projectId?: string;
  sessionId?: string;
  role: string;
}
export interface ArtifactFilters { projectId?: string; sessionId?: string }
