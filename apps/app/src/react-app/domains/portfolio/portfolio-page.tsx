/** @jsxImportSource react */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, FolderKanban, Plus } from "lucide-react";
import type { OpenworkServerClient, PortfolioLifecycleStage, PortfolioProject } from "@/app/lib/openwork-server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PortfolioWorkspaceSelector, type PortfolioWorkspaceOption } from "./portfolio-workspace-selector";
import { ResearchHistory } from "./research-history";

const lifecycleStages: PortfolioLifecycleStage[] = ["research", "planning", "creation", "review", "release", "publication", "promotion", "measurement", "archived"];

export function portfolioProjectTree(projects: PortfolioProject[]) {
  return projects.filter((project) => project.parentProjectId === null).map((project) => ({ project, children: projects.filter((candidate) => candidate.parentProjectId === project.id) }));
}

export function PortfolioPage({ client, workspaceId, selectedWorkspaceId, workspaces, onSelectWorkspace }: {
  client: OpenworkServerClient;
  workspaceId: string;
  selectedWorkspaceId: string;
  workspaces: PortfolioWorkspaceOption[];
  onSelectWorkspace: (workspaceId: string) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["portfolio", client.baseUrl, workspaceId];
  const portfolio = useQuery({ queryKey, queryFn: () => client.getPortfolio(workspaceId) });
  const [portfolioName, setPortfolioName] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("project");
  const [vertical, setVertical] = useState("publishing");
  const [parentProjectId, setParentProjectId] = useState("");
  const [researchProjectId, setResearchProjectId] = useState<string | null>(null);
  const initialize = useMutation({ mutationFn: () => client.initializePortfolio(workspaceId, { name: portfolioName }), onSuccess: (value) => queryClient.setQueryData(queryKey, value) });
  const createProject = useMutation({ mutationFn: () => client.createPortfolioProject(workspaceId, { idempotencyKey: crypto.randomUUID(), title, kind, vertical, lifecycleStage: "research", parentProjectId: parentProjectId || undefined }), onSuccess: async () => { setTitle(""); setParentProjectId(""); await queryClient.invalidateQueries({ queryKey }); } });
  const updateStage = useMutation({ mutationFn: ({ project, lifecycleStage }: { project: PortfolioProject; lifecycleStage: PortfolioLifecycleStage }) => client.updatePortfolioProject(workspaceId, project.id, { expectedRevision: project.revision, lifecycleStage }), onSuccess: async () => queryClient.invalidateQueries({ queryKey }) });

  const workspacePicker = <PortfolioWorkspaceSelector selectedWorkspaceId={selectedWorkspaceId} workspaces={workspaces} onSelectWorkspace={onSelectWorkspace} />;

  if (portfolio.isLoading) return <PortfolioShell workspacePicker={workspacePicker}><div className="grid flex-1 place-items-center text-muted-foreground">Loading portfolio…</div></PortfolioShell>;
  if (portfolio.isError) return <PortfolioShell workspacePicker={workspacePicker}><div className="grid flex-1 place-items-center p-8 text-destructive">{portfolio.error instanceof Error ? portfolio.error.message : "Portfolio could not be loaded."}</div></PortfolioShell>;
  if (!portfolio.data || portfolio.data.state === "uninitialized") return <PortfolioShell workspacePicker={workspacePicker}><div className="grid flex-1 place-items-center p-8"><Card className="w-full max-w-lg"><CardHeader><CardTitle>Create this workspace’s portfolio</CardTitle><CardDescription>Track projects from research through publication and promotion. Files and conversations remain local.</CardDescription></CardHeader><CardContent className="flex gap-2"><Input aria-label="Portfolio name" value={portfolioName} onChange={(event) => setPortfolioName(event.target.value)} placeholder="Studio portfolio" /><Button disabled={!portfolioName.trim() || initialize.isPending} onClick={() => initialize.mutate()}>Create portfolio</Button></CardContent></Card></div></PortfolioShell>;

  const projects = portfolio.data.snapshot.projects;
  const selectedResearchProject = projects.find((project) => project.id === researchProjectId && project.kind.trim().toLowerCase() === "research");
  const showResearch = (project: PortfolioProject) => setResearchProjectId((current) => current === project.id ? null : project.id);
  return <PortfolioShell workspacePicker={workspacePicker}><div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6" data-portfolio-page><div><h1 className="text-2xl font-semibold">{portfolio.data.snapshot.portfolio.name}</h1><p className="text-sm text-muted-foreground">Projects across publishing, music, video, drama, and future verticals.</p></div><Card><CardHeader><CardTitle className="text-base">New project</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_9rem_9rem_12rem_auto]"><Input aria-label="Project title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Project title" /><Input aria-label="Project kind" value={kind} onChange={(event) => setKind(event.target.value)} placeholder="book, album…" /><Input aria-label="Project vertical" value={vertical} onChange={(event) => setVertical(event.target.value)} placeholder="publishing…" /><select aria-label="Parent project" className="h-9 rounded-md border bg-background px-2 text-sm" value={parentProjectId} onChange={(event) => setParentProjectId(event.target.value)}><option value="">Top-level project</option>{projects.filter((project) => project.parentProjectId === null).map((project) => <option key={project.id} value={project.id}>Child of {project.title}</option>)}</select><Button disabled={!title.trim() || !kind.trim() || !vertical.trim() || createProject.isPending} onClick={() => createProject.mutate()}><Plus className="size-4" />Add</Button></CardContent></Card>{projects.length === 0 ? <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground"><FolderKanban className="mx-auto mb-3 size-8" />No projects yet.</div> : <div className="grid gap-3">{portfolioProjectTree(projects).map(({ project, children }) => <Card key={project.id}><CardContent className="pt-6"><ProjectRow project={project} onStage={(lifecycleStage) => updateStage.mutate({ project, lifecycleStage })} onResearch={project.kind.trim().toLowerCase() === "research" ? () => showResearch(project) : undefined} researchOpen={researchProjectId === project.id} />{children.length ? <div className="mt-4 grid gap-2 border-l pl-5">{children.map((child) => <ProjectRow key={child.id} project={child} onStage={(lifecycleStage) => updateStage.mutate({ project: child, lifecycleStage })} onResearch={child.kind.trim().toLowerCase() === "research" ? () => showResearch(child) : undefined} researchOpen={researchProjectId === child.id} />)}</div> : null}</CardContent></Card>)}</div>}{selectedResearchProject ? <ResearchHistory client={client} workspaceId={workspaceId} project={selectedResearchProject} /> : null}</div></PortfolioShell>;
}

function PortfolioShell({ workspacePicker, children }: { workspacePicker: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex h-full flex-col overflow-auto"><div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-background/95 px-6 py-3 backdrop-blur"><div><div className="font-semibold">Portfolio</div><div className="text-xs text-muted-foreground">Each workspace has its own local portfolio.</div></div>{workspacePicker}</div>{children}</div>;
}

function ProjectRow({ project, onStage, onResearch, researchOpen }: { project: PortfolioProject; onStage: (stage: PortfolioLifecycleStage) => void; onResearch?: () => void; researchOpen?: boolean }) {
  return <div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><div className="truncate font-medium">{project.title}</div><div className="text-xs text-muted-foreground">{project.vertical} · {project.kind}</div></div>{onResearch ? <Button variant={researchOpen ? "secondary" : "outline"} size="sm" aria-expanded={researchOpen} onClick={onResearch}><FlaskConical className="size-4" />History</Button> : null}<Badge variant="outline">{project.lifecycleStage}</Badge><select aria-label={`Lifecycle for ${project.title}`} className="h-8 rounded-md border bg-background px-2 text-sm" value={project.lifecycleStage} onChange={(event) => onStage(event.target.value as PortfolioLifecycleStage)}>{lifecycleStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></div>;
}
