import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchHistorySummary } from "../src/react-app/domains/portfolio/research-history";

describe("portfolio research history", () => {
  test("renders longitudinal observations and immutable decisions", () => {
    const html = renderToStaticMarkup(<ResearchHistorySummary history={{
      runs: [{ id: "run_1", projectId: "prj_1", researchType: "kdp.niche", trigger: "manual", status: "completed", requestPayload: {}, requestDigest: "request-digest", startedAt: "2026-08-01T10:00:00.000Z", completedAt: "2026-08-01T10:05:00.000Z", createdAt: "2026-08-01T10:00:00.000Z" }],
      snapshots: [{ id: "snap_1", projectId: "prj_1", runId: "run_1", sequence: 1, state: "complete", capturedAt: "2026-08-01T10:03:00.000Z", sealedAt: "2026-08-01T10:04:00.000Z", supersedesSnapshotId: null, canonicalPayload: {}, canonicalPayloadDigest: "payload-digest", diagnosticSummary: {} }],
      observations: [
        { id: "obs_1", snapshotId: "snap_1", subjectType: "keyword", subjectKey: "keyword:cozy mystery", metric: "search_results", valueType: "integer", canonicalValue: 1200, unit: "results", provider: "amazon", providerVersion: null, evidenceRefs: [], observationDigest: "obs1", observedAt: "2026-08-01T10:03:00.000Z" },
        { id: "obs_2", snapshotId: "snap_2", subjectType: "keyword", subjectKey: "keyword:cozy mystery", metric: "search_results", valueType: "integer", canonicalValue: 900, unit: "results", provider: "amazon", providerVersion: null, evidenceRefs: [], observationDigest: "obs2", observedAt: "2026-08-08T10:03:00.000Z" },
      ],
      evidence: [{ id: "evi_1", snapshotId: "snap_1", observationId: null, artifactId: "art_1", artifactVersionId: "artifact-version-1", role: "research-brief", capturedAt: "2026-08-01T10:04:00.000Z", rightsClassification: null, createdAt: "2026-08-01T10:04:00.000Z" }],
      evaluations: [{ id: "eval_1", projectId: "prj_1", snapshotId: "snap_1", evaluationType: "keyword-opportunity", policyRef: "policy.v1", engineRef: "engine.v1", evaluationAsOf: "2026-08-01T10:04:30.000Z", requestPayload: {}, requestDigest: "eval-request-digest", resultPayload: {}, resultDigest: "eval-result-digest", createdAt: "2026-08-01T10:04:30.000Z" }],
      decisions: [{ id: "dec_1", projectId: "prj_1", evaluationId: null, decision: "accept", rationale: "Competition improved", selectedSubjectRefs: ["keyword:cozy mystery"], requestedFollowUp: [], actorRef: "user", decidedAt: "2026-08-08T11:00:00.000Z", supersedesDecisionId: null }],
    }} />);

    expect(html).toContain("Research history");
    expect(html).toContain("keyword:cozy mystery");
    expect(html).toContain("1,200");
    expect(html).toContain("900");
    expect(html).toContain("completed");
    expect(html).toContain("payload-digest");
    expect(html).toContain("policy.v1");
    expect(html).toContain("eval-result-digest");
    expect(html).toContain("artifact-version-1");
    expect(html).toContain("Competition improved");
  });
});
