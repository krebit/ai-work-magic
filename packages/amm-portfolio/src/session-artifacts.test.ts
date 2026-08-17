import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { initializePortfolio, openPortfolioRepository } from "./index.js";

const roots: string[] = [];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "amm-artifacts-"));
  roots.push(root);
  initializePortfolio(root, { name: "Creator Portfolio" });
  return { root, repository: openPortfolioRepository(root) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("session context", () => {
  test("links an OpenCode session to portfolio or project context", async () => {
    const { repository } = await setup();
    assert.equal(repository.getSessionContext("ses_portfolio"), null);
    const portfolioContext = repository.putSessionContext("ses_portfolio", {});
    assert.equal(portfolioContext.projectId, null);

    const project = repository.createProject({ idempotencyKey: "p1", title: "Launch", kind: "campaign", vertical: "marketing", lifecycleStage: "planning" });
    const scoped = repository.putSessionContext("ses_project", { projectId: project.id });
    assert.equal(scoped.projectId, project.id);
    assert.equal(repository.getSessionContext("ses_project")?.projectId, project.id);
    assert.throws(() => repository.putSessionContext("ses_missing", { projectId: "missing" }), { message: "project_not_found" });
    repository.close();
  });
});

describe("registered artifacts", () => {
  test("registers immutable file versions and filters by project and session", async () => {
    const { root, repository } = await setup();
    const project = repository.createProject({ idempotencyKey: "p1", title: "Album", kind: "album", vertical: "music", lifecycleStage: "creation" });
    await mkdir(join(root, "projects", "album"), { recursive: true });
    await writeFile(join(root, "projects", "album", "cover.txt"), "version one");

    const first = repository.registerArtifact({ path: "projects/album/cover.txt", projectId: project.id, sessionId: "ses_1", role: "cover" });
    assert.equal(first.path, "projects/album/cover.txt");
    assert.equal(first.versions.length, 1);
    assert.equal(repository.registerArtifact({ path: "projects/album/cover.txt", projectId: project.id, sessionId: "ses_1", role: "cover" }).versions.length, 1);

    await writeFile(join(root, "projects", "album", "cover.txt"), "version two");
    const changed = repository.registerArtifact({ path: "projects/album/cover.txt", projectId: project.id, sessionId: "ses_1", role: "cover" });
    assert.equal(changed.versions.length, 2);
    assert.equal(repository.listArtifacts({ projectId: project.id }).length, 1);
    assert.equal(repository.listArtifacts({ sessionId: "other" }).length, 0);
    repository.close();
  });

  test("rejects paths outside the workspace", async () => {
    const { repository } = await setup();
    assert.throws(() => repository.registerArtifact({ path: "../secret.txt", role: "document" }), { message: "artifact_path_invalid" });
    assert.throws(() => repository.registerArtifact({ path: "/tmp/secret.txt", role: "document" }), { message: "artifact_path_invalid" });
    repository.close();
  });
});
