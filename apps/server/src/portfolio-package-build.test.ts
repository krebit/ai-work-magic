import { describe, expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };

describe("portfolio package build integration", () => {
  test("builds the portfolio package before compiling the server", () => {
    expect(packageJson.scripts["build:portfolio"]).toBe("pnpm --filter @openwork/amm-portfolio build");
    expect(packageJson.scripts.build).toStartWith("pnpm build:portfolio && ");
    expect(packageJson.scripts["build:bin"]).toStartWith("pnpm build:portfolio && ");
  });
});
