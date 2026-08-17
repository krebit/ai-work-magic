/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioWorkspaceSelector } from "../src/react-app/domains/portfolio/portfolio-workspace-selector";

describe("Portfolio workspace selector", () => {
  test("identifies the active workspace and offers every workspace", () => {
    const html = renderToStaticMarkup(
      <PortfolioWorkspaceSelector
        selectedWorkspaceId="ws_two"
        workspaces={[
          { id: "ws_one", name: "OpenWork" },
          { id: "ws_two", name: "Test OpenWork 2" },
        ]}
        onSelectWorkspace={() => undefined}
      />,
    );

    expect(html).toContain("Portfolio workspace");
    expect(html).toContain('<option value="ws_one">OpenWork</option>');
    expect(html).toContain('<option value="ws_two" selected="">Test OpenWork 2</option>');
  });
});
