import { describe, expect, test } from "bun:test";
import { portfolioProjectTree } from "../src/react-app/domains/portfolio/portfolio-page";
import type { PortfolioProject } from "../src/app/lib/openwork-server";

function project(id: string, parentProjectId: string | null, vertical: string): PortfolioProject {
  return { id, parentProjectId, title: id, kind: "project", vertical, lifecycleStage: "planning", revision: 1, createdAt: "2026-08-16", updatedAt: "2026-08-16" };
}

describe("portfolio project tree", () => {
  test("groups one child level while preserving mixed verticals", () => {
    const tree = portfolioProjectTree([project("book", null, "publishing"), project("edition", "book", "publishing"), project("album", null, "music")]);
    expect(tree.map((node) => [node.project.id, node.children.map((child) => child.id)])).toEqual([["book", ["edition"]], ["album", []]]);
  });
});
