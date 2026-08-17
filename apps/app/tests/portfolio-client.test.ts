import { afterEach, describe, expect, test } from "bun:test";
import { createOpenworkServerClient } from "../src/app/lib/openwork-server";

const stops: Array<() => void> = [];
afterEach(() => { while (stops.length) stops.pop()?.(); });

async function controlledServer() {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "GET" ? null : await request.json();
      requests.push({ method: request.method, path: url.pathname, body });
      if (request.method === "GET") return Response.json({ state: "uninitialized" });
      if (url.pathname.endsWith("/projects")) return Response.json({ id: "prj_1", revision: 1 }, { status: 201 });
      return Response.json({ state: "ready", snapshot: { portfolio: { id: "pf_1", name: "Studio" }, projects: [], relationships: [] } }, { status: 201 });
    },
  });
  stops.push(() => server.stop());
  return { requests, client: createOpenworkServerClient({ baseUrl: `http://127.0.0.1:${server.port}`, token: "token" }) };
}

describe("portfolio client", () => {
  test("uses workspace-scoped portfolio routes", async () => {
    const { client, requests } = await controlledServer();
    await client.getPortfolio("ws one");
    await client.initializePortfolio("ws one", { name: "Studio" });
    await client.createPortfolioProject("ws one", { idempotencyKey: "p1", title: "Novel", kind: "book", vertical: "publishing", lifecycleStage: "research" });
    expect(requests).toEqual([
      { method: "GET", path: "/workspace/ws%20one/portfolio", body: null },
      { method: "POST", path: "/workspace/ws%20one/portfolio", body: { name: "Studio" } },
      { method: "POST", path: "/workspace/ws%20one/portfolio/projects", body: { idempotencyKey: "p1", title: "Novel", kind: "book", vertical: "publishing", lifecycleStage: "research" } },
    ]);
  });
});
