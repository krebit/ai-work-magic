import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { initializePortfolio, openPortfolioRepository } from "./index.js";

const roots: string[] = [];

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "amm-research-"));
  roots.push(root);
  initializePortfolio(root, { name: "Research Studio" });
  return { repo: openPortfolioRepository(root), root };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Portfolio research history", () => {
  test("preserves longitudinal observations, evaluations, and decisions under one Portfolio project", async () => {
    const { repo, root } = await repository();
    const project = repo.createProject({ idempotencyKey: "project", title: "Camping journals", kind: "research", vertical: "amazon-kdp", lifecycleStage: "research" });
    const run = repo.createResearchRun(project.id, { idempotencyKey: "run", researchType: "amazon-kdp.keyword-opportunity", trigger: "manual", requestPayload: { keyword: "camping journal" }, startedAt: "2026-08-01T00:00:00.000Z" });
    const first = repo.sealResearchSnapshot(project.id, { idempotencyKey: "snapshot-1", runId: run.id, state: "complete", capturedAt: "2026-08-01T00:01:00.000Z", sealedAt: "2026-08-01T00:02:00.000Z", canonicalPayload: { keyword: "camping journal", resultCount: 1200 }, observations: [{ subjectType: "keyword", subjectKey: "camping journal", metric: "amazon_search_result_count", valueType: "integer", canonicalValue: 1200, provider: "fixture", observedAt: "2026-08-01T00:01:00.000Z" }] });
    await writeFile(join(root, "evidence.json"), "{}");
    const artifact = repo.registerArtifact({ path: "evidence.json", projectId: project.id, role: "research-evidence" });
    repo.linkResearchEvidence(project.id, { idempotencyKey: "evidence", snapshotId: first.id, artifactId: artifact.id, artifactVersionId: artifact.versions[0]!.id, role: "provider-response", capturedAt: "2026-08-01T00:01:00.000Z" });
    repo.sealResearchSnapshot(project.id, { idempotencyKey: "snapshot-2", runId: run.id, state: "complete", capturedAt: "2026-08-08T00:01:00.000Z", sealedAt: "2026-08-08T00:02:00.000Z", supersedesSnapshotId: first.id, canonicalPayload: { keyword: "camping journal", resultCount: 900 }, observations: [{ subjectType: "keyword", subjectKey: "camping journal", metric: "amazon_search_result_count", valueType: "integer", canonicalValue: 900, provider: "fixture", observedAt: "2026-08-08T00:01:00.000Z" }] });
    repo.completeResearchRun(project.id, run.id, { idempotencyKey: "run-complete", status: "completed", completedAt: "2026-08-08T00:03:00.000Z" });
    const evaluation = repo.recordResearchEvaluation(project.id, { idempotencyKey: "evaluation", snapshotId: first.id, evaluationType: "keyword-opportunity", policyRef: "policy/v1", evaluationAsOf: "2026-08-01T00:02:00.000Z", requestPayload: { snapshotId: first.id }, resultPayload: { score: "72.5" } });
    repo.recordResearchDecision(project.id, { idempotencyKey: "decision", evaluationId: evaluation.id, decision: "more-research", rationale: "Competition changed", actorRef: "user:test", decidedAt: "2026-08-08T00:04:00.000Z" });

    const history = repo.getResearchHistory(project.id);
    assert.equal(history.runs.length, 1);
    assert.equal(history.snapshots.length, 2);
    assert.deepEqual(history.observations.map((item) => item.canonicalValue), [1200, 900]);
    assert.equal(history.evaluations[0]?.resultPayload.score, "72.5");
    assert.equal(history.decisions[0]?.decision, "more-research");
    assert.equal(history.evidence[0]?.artifactVersionId, artifact.versions[0]!.id);
    repo.close();
  });

  test("rejects research records on a non-research project", async () => {
    const { repo } = await repository();
    const project = repo.createProject({ idempotencyKey: "book", title: "Book", kind: "book", vertical: "publishing", lifecycleStage: "planning" });
    assert.throws(() => repo.createResearchRun(project.id, { idempotencyKey: "run", researchType: "test", trigger: "manual", requestPayload: {}, startedAt: "2026-08-01T00:00:00.000Z" }), { message: "research_project_kind_required" });
    repo.close();
  });
});
