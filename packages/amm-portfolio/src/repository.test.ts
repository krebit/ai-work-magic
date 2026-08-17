import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  initializePortfolio,
  inspectPortfolio,
  openPortfolioRepository,
} from "./index.js";

const roots: string[] = [];

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "amm-portfolio-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portfolio initialization", () => {
  test("inspection does not initialize an ordinary workspace", async () => {
    const root = await temporaryWorkspace();

    assert.deepEqual(inspectPortfolio(root), { state: "uninitialized" });
    assert.equal(existsSync(join(root, ".amm")), false);
    assert.equal(existsSync(join(root, "portfolio.yaml")), false);
  });

  test("initialization persists one portable portfolio", async () => {
    const root = await temporaryWorkspace();

    const initialized = initializePortfolio(root, {
      name: "Storyworld Studio",
      defaultVertical: "publishing",
    });

    assert.equal(initialized.portfolio.name, "Storyworld Studio");
    assert.equal(existsSync(join(root, "portfolio.yaml")), true);
    assert.equal(existsSync(join(root, ".amm", "portfolio.sqlite")), true);

    const repository = openPortfolioRepository(root);
    assert.equal(repository.getSnapshot().portfolio.id, initialized.portfolio.id);
    repository.close();
  });
});

describe("portfolio projects and relationships", () => {
  async function repository() {
    const root = await temporaryWorkspace();
    initializePortfolio(root, { name: "Mixed Media Studio" });
    return openPortfolioRepository(root);
  }

  test("stores mixed verticals with at most one child level", async () => {
    const repo = await repository();
    const series = repo.createProject({
      idempotencyKey: "series-1",
      title: "Moon Harbor",
      kind: "series",
      vertical: "short-drama",
      lifecycleStage: "planning",
    });
    const episode = repo.createProject({
      idempotencyKey: "episode-1",
      parentProjectId: series.id,
      title: "Episode One",
      kind: "episode",
      vertical: "short-drama",
      lifecycleStage: "creation",
    });
    repo.createProject({
      idempotencyKey: "album-1",
      title: "Night Signals",
      kind: "album",
      vertical: "music",
      lifecycleStage: "release",
    });

    assert.throws(() => repo.createProject({
      idempotencyKey: "scene-1",
      parentProjectId: episode.id,
      title: "Scene One",
      kind: "scene",
      vertical: "short-drama",
      lifecycleStage: "creation",
    }), { message: "project_depth_exceeded" });
    assert.deepEqual(repo.listProjects().map((project) => project.vertical).sort(), ["music", "short-drama", "short-drama"]);
    repo.close();
  });

  test("makes create idempotent and updates with optimistic revisions", async () => {
    const repo = await repository();
    const input = {
      idempotencyKey: "book-1",
      title: "Calm Patterns",
      kind: "book",
      vertical: "publishing",
      lifecycleStage: "research" as const,
    };
    const created = repo.createProject(input);
    assert.equal(repo.createProject(input).id, created.id);
    assert.throws(() => repo.createProject({ ...input, title: "Changed" }), { message: "idempotency_conflict" });

    const updated = repo.updateProject(created.id, { expectedRevision: 1, lifecycleStage: "planning" });
    assert.equal(updated.revision, 2);
    assert.equal(updated.lifecycleStage, "planning");
    assert.throws(() => repo.updateProject(created.id, { expectedRevision: 1, title: "Stale" }), { message: "revision_conflict" });
    repo.close();
  });

  test("validates directed project relationships", async () => {
    const repo = await repository();
    const source = repo.createProject({ idempotencyKey: "source", title: "Novel", kind: "book", vertical: "publishing", lifecycleStage: "publication" });
    const target = repo.createProject({ idempotencyKey: "target", title: "Screen Series", kind: "series", vertical: "video", lifecycleStage: "planning" });

    const relationship = repo.createRelationship({ sourceProjectId: target.id, targetProjectId: source.id, type: "adaptation-of" });
    assert.equal(relationship.type, "adaptation-of");
    assert.throws(() => repo.createRelationship({ sourceProjectId: source.id, targetProjectId: source.id, type: "companion-to" }), { message: "relationship_self_reference" });
    assert.throws(() => repo.createRelationship({ sourceProjectId: target.id, targetProjectId: source.id, type: "adaptation-of" }), { message: "relationship_exists" });
    assert.throws(() => repo.createRelationship({ sourceProjectId: "missing", targetProjectId: source.id, type: "derived-from" }), { message: "project_not_found" });
    repo.close();
  });
});
