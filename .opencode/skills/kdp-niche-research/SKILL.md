---
name: kdp-niche-research
description: "Evidence-backed KDP niche discovery and decision support. Use when the user asks to produce, review, or continue KDP Niche Research outcomes."
---

# KDP Niche Research

Deliver these outcomes:
- Ranked niche brief
- Competitor and review analysis
- Transparent opportunity scoring

## Operating workflow

1. Inspect the available AMM capabilities and services listed below before planning the run.
2. State which required dependencies are available and identify any missing implementation honestly.
3. Confirm the intended outcome, evidence requirements, authority boundary, and budget.
4. Prefer reusable AMM tools and recorded evidence over ad hoc automation.
5. Keep consequential actions in a reviewable queue when approval is required.
6. Return artifacts, evidence lineage, exceptions, and the next recommended action.

## Canonical managed-research workflow

Follow this sequence for durable KDP niche research. Keep every identifier,
payload, digest, observation, artifact version, and status explicit; never
substitute an AMM run identifier for a Den operation identifier.

1. Confirm the niche, Amazon marketplace, language, department, format,
   currency, evidence level, freshness intent, evaluation time, and budget.
   Enforce the user's tighter limits and the absolute collection caps of 20
   capability units, 3 products, 1 page, and search depth 3.
2. Call `portfolio.inspect` for the active local workspace. If Portfolio is
   uninitialized, call `portfolio.initialize` only when the user's request
   implies durable KDP research. Reuse the one matching research project, or
   call `portfolio.project.create` exactly once with `kind: "research"`,
   `vertical: "amazon-kdp"`, and a stable title derived from the normalized
   niche, `lifecycleStage: "research"`, and a stable project idempotency key.
   Do not create a `book` project.
3. Search Den for exactly `kdp keyword research observations`. Use only exact
   capability names returned by that search, and require
   `startAmmKdpKeywordCollection`, `getAmmResearchOperation`,
   `getAmmKdpKeywordObservations`, and `scoreAmmKdpKeywords`. If any is
   unavailable, report the missing operation and do not claim it ran.
4. Build one immutable canonical request payload and its digest. Before any paid
   execution, call `portfolio.research.run.create` with the research project,
   a stable local idempotency key, `researchType` set to
   `amazon-kdp.keyword-opportunity`, the canonical request, trigger, and start
   time. Retain the returned Portfolio research run ID separately from Den's
   operation ID.
5. Generate one stable Den `operationKey` from the canonical request identity
   and reuse the same key and byte-equivalent body for every retry. Start one
   logical collection with `startAmmKdpKeywordCollection` and the requested
   limits bounded by `maxUnits: 20`, `maxProducts: 3`, `maxPages: 1`, and
   `searchDepth: 3`. Retried calls must represent that same collection and
   must never widen a limit.
6. Poll `getAmmResearchOperation` with the returned Den operation ID until a
   terminal state; never poll with an AMM run ID. Then call
   `getAmmKdpKeywordObservations` for the same keyword and context so the
   collection result and reusable identity-free observations can be reconciled.
7. Before local persistence, validate the returned collection payload against
   the real strict Den contract for the versioned KDP result, including
   `amm.kdp.managed-keyword-collection.result/v1`, and validate every selected
   observation. Reject credentials, tokens, signed query parameters, or other
   secret-bearing URLs. Never store an unvalidated provider response as a
   trusted observation.
8. Report provider degradation and incomplete evidence honestly. Map a complete
   valid result to `completed`, a valid degraded/incomplete result to
   `partial`, a failed or expired operation to `failed`, and cancellation to
   `cancelled`. Call `portfolio.research.run.complete` with the retained
   Portfolio run ID, matching terminal status, completion time, and a stable
   completion idempotency key; do not rewrite a terminal run.
9. For a validated complete or partial result, call
   `portfolio.research.snapshot.seal` exactly once with a stable snapshot
   idempotency key, the retained Portfolio run ID, `state: "complete"` or
   `state: "partial"`, capture and seal times, the canonical KDP payload whose
   `schemaVersion` identifies its contract, diagnostics, and typed
   observations. Each observation input must include subject type/key, metric,
   canonical value and value type, unit when applicable, provider and provider
   version, observed time, and evidence references. Retain the returned
   snapshot ID and canonical-payload digest, and verify the returned observation
   digests. Never seal invented or unvalidated values.
10. Derive the documented 0–100 demand and competition inputs only from the
    validated returned observations. Never invent, impute, or silently default
    a missing metric. Invoke `scoreAmmKdpKeywords` only with candidates whose
    required inputs can be derived, and preserve the exact score request and
    result. Call `portfolio.research.evaluation.record` with a stable
    evaluation idempotency key, the snapshot ID, evaluation type, policy and
    engine identity, `evaluationAsOf`, and the exact request and result
    payloads; retain and verify the returned request and result digests. If
    scoring is impossible, record the missing-input diagnostic rather than
    fabricating an evaluation.
11. Write `research/kdp/<slug>-niche-brief.md` with the keyword, evaluation
    time, returned metrics and products, safe evidence sources, diagnostics,
    score inputs and calculation, and the next explicit approval. Call
    `portfolio.artifact.register` with that workspace-relative path, the
    research project ID, and `role: "research-brief"`. Retain the returned
    artifact and exact artifact-version IDs, then call
    `portfolio.research.evidence.link` with a stable evidence idempotency key,
    snapshot ID, artifact ID, artifact-version ID, `role: "research-brief"`,
    capture time,
    and rights classification when known. Pin that exact version to the saved
    snapshot.
12. Query `portfolio.research.inspect` and
    `portfolio.research.observations.list` to verify the run, snapshot,
    observations, evaluation, and linked evidence are readable. Do not call
    `portfolio.research.decision.record` unless the user explicitly chooses
    `accept`, `reject`, or `more-research`.
13. Return the evidence-backed brief, diagnostics, operation/run status, and the
    next human approval. Stop before resulting book-project creation,
    manuscript creation, publication, or any further spend.


## Required AMM dependencies

- `amm.capability.social-research`
- `amm.capability.amazon-kdp`
- `amm.capability.analytics-experiments`
- `amm.capability.amazon-kdp.keyword-opportunity-scoring`
- `amm.provider.browser-session`
- `amm.service.evidence-artifacts`
- `amm.service.workflow-engine`
- `amm.service.policy-approvals`
- `amm.service.vertical-data`

## Runtime contract

- Treat `amm.vertical.kdp-niche-research` and `0.1.0` as the canonical package identity and version.
- Read `amm.package.yaml` when it is available for permissions, execution targets, budgets, and evaluation requirements.
- Do not claim that a planned or unavailable capability ran successfully.
- Do not bypass AMM policy, approval, evidence, or hosted-data service boundaries.
