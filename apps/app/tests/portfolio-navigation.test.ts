import { describe, expect, test } from "bun:test";
import { portfolioNavigationWorkspaceId, workspaceSelectionRoute } from "../src/react-app/shell/workspace-routes";

describe("Portfolio sidebar navigation", () => {
  test("uses the sidebar workspace on legacy session routes", () => {
    expect(portfolioNavigationWorkspaceId("", "ws_active")).toBe("ws_active");
    expect(portfolioNavigationWorkspaceId("ws_route", "ws_active")).toBe("ws_route");
    expect(portfolioNavigationWorkspaceId("", "", "ws_visible")).toBe("ws_visible");
    expect(portfolioNavigationWorkspaceId("", "")).toBeNull();
  });

  test("keeps workspace selection inside Portfolio while Portfolio is open", () => {
    expect(workspaceSelectionRoute("ws_two", true)).toBe("/workspace/ws_two/portfolio");
    expect(workspaceSelectionRoute("ws_two", false)).toBe("/workspace/ws_two/session");
  });
});
