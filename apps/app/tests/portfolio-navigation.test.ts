import { describe, expect, test } from "bun:test";
import { portfolioNavigationWorkspaceId } from "../src/react-app/shell/workspace-routes";

describe("Portfolio sidebar navigation", () => {
  test("uses the sidebar workspace on legacy session routes", () => {
    expect(portfolioNavigationWorkspaceId("", "ws_active")).toBe("ws_active");
    expect(portfolioNavigationWorkspaceId("ws_route", "ws_active")).toBe("ws_route");
    expect(portfolioNavigationWorkspaceId("", "")).toBeNull();
  });
});
