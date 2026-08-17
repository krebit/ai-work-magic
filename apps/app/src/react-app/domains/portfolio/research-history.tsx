/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, FlaskConical } from "lucide-react";
import type { OpenworkServerClient, PortfolioProject, PortfolioResearchHistory } from "@/app/lib/openwork-server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function displayValue(value: unknown) {
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function ResearchHistorySummary({ history }: { history: PortfolioResearchHistory }) {
  return <div className="grid gap-4" aria-label="Research history">
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><CardHeader className="pb-2"><CardDescription>Runs</CardDescription><CardTitle>{history.runs.length}</CardTitle></CardHeader></Card>
      <Card><CardHeader className="pb-2"><CardDescription>Snapshots</CardDescription><CardTitle>{history.snapshots.length}</CardTitle></CardHeader></Card>
      <Card><CardHeader className="pb-2"><CardDescription>Observations</CardDescription><CardTitle>{history.observations.length}</CardTitle></CardHeader></Card>
    </div>
    <Card><CardHeader><CardTitle className="text-base">Runs and snapshots</CardTitle><CardDescription>Terminal state and immutable canonical payload digests.</CardDescription></CardHeader><CardContent className="grid gap-2">{history.runs.map((run) => <div key={run.id} className="rounded-lg border p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{run.researchType}</span><Badge variant="outline" data-testid="research-run-status">{run.status}</Badge></div><div className="mt-1 font-mono text-xs text-muted-foreground">{run.id}</div></div>)}{history.snapshots.map((snapshot) => <div key={snapshot.id} className="rounded-lg border p-3 text-sm"><div className="flex items-center justify-between gap-2"><span>Snapshot {snapshot.sequence}</span><Badge variant="outline">{snapshot.state}</Badge></div><div className="mt-1 font-mono text-xs text-muted-foreground" data-testid="research-snapshot-digest">{snapshot.canonicalPayloadDigest}</div></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="size-4" />Observation timeline</CardTitle><CardDescription>Immutable measurements preserved across research runs.</CardDescription></CardHeader><CardContent>{history.observations.length === 0 ? <p className="text-sm text-muted-foreground">No observations have been recorded yet. Ask the agent to research this project.</p> : <div className="grid gap-2">{history.observations.map((observation) => <div key={observation.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"><div className="min-w-0 flex-1"><div className="font-medium">{observation.subjectKey}</div><div className="text-xs text-muted-foreground">{observation.metric} · {displayDate(observation.observedAt)}</div></div><span className="font-mono font-medium">{displayValue(observation.canonicalValue)}</span>{observation.unit ? <span className="text-muted-foreground">{observation.unit}</span> : null}</div>)}</div>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="size-4" />Decision log</CardTitle><CardDescription>Recorded conclusions remain attributable and auditable.</CardDescription></CardHeader><CardContent>{history.decisions.length === 0 ? <p className="text-sm text-muted-foreground">No decisions recorded yet.</p> : <div className="grid gap-2">{history.decisions.map((decision) => <div key={decision.id} className="rounded-lg border p-3"><div className="mb-1 flex items-center gap-2"><Badge variant="outline">{decision.decision}</Badge><span className="text-xs text-muted-foreground">{displayDate(decision.decidedAt)} · {decision.actorRef}</span></div><p className="text-sm">{decision.rationale}</p></div>)}</div>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Evaluation</CardTitle><CardDescription>Policy and immutable scoring result for the latest research snapshot.</CardDescription></CardHeader><CardContent className="grid gap-2">{history.evaluations.length === 0 ? <p className="text-sm text-muted-foreground">No evaluation recorded yet.</p> : history.evaluations.map((evaluation) => <div key={evaluation.id} className="rounded-lg border p-3 text-sm"><div className="font-medium">{evaluation.evaluationType}</div><div data-testid="research-evaluation-policy">Policy: {evaluation.policyRef}</div><div className="font-mono text-xs text-muted-foreground" data-testid="research-evaluation-result-digest">{evaluation.resultDigest}</div></div>)}</CardContent></Card>
    {history.evidence.length ? <Card><CardHeader><CardTitle className="text-base">Evidence</CardTitle><CardDescription>Exact registered artifact versions pinned to this history.</CardDescription></CardHeader><CardContent className="grid gap-2">{history.evidence.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>{item.role}</span><span className="font-mono text-xs text-muted-foreground">{item.artifactVersionId}</span></div>)}</CardContent></Card> : null}
  </div>;
}

export function ResearchHistory({ client, workspaceId, project }: { client: OpenworkServerClient; workspaceId: string; project: PortfolioProject }) {
  const history = useQuery({ queryKey: ["portfolio-research", client.baseUrl, workspaceId, project.id], queryFn: () => client.getPortfolioResearchHistory(workspaceId, project.id) });
  return <section className="grid gap-4" aria-labelledby="research-history-title"><div><h2 id="research-history-title" className="flex items-center gap-2 text-xl font-semibold"><FlaskConical className="size-5" />Research history</h2><p className="text-sm text-muted-foreground">Longitudinal evidence for {project.title}</p></div>{history.isLoading ? <div className="rounded-xl border p-8 text-center text-muted-foreground">Loading research history…</div> : history.isError ? <div className="rounded-xl border border-destructive/50 p-4 text-destructive">{history.error instanceof Error ? history.error.message : "Research history could not be loaded."}</div> : history.data ? <ResearchHistorySummary history={history.data} /> : null}</section>;
}
