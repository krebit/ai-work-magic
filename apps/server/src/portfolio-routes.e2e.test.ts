import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "openwork-portfolio-routes-"));
  roots.push(root);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "owt_portfolio", hostToken: "owt_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Studio", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { root, base: `http://127.0.0.1:${server.port}`, headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" } };
}

describe("portfolio API", () => {
  test("requires client auth and initializes only on explicit mutation", async () => {
    const { root, base, headers } = await setup();
    expect((await fetch(`${base}/workspace/ws_1/portfolio`)).status).toBe(401);
    const inspected = await fetch(`${base}/workspace/ws_1/portfolio`, { headers });
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toEqual({ state: "uninitialized" });
    expect(existsSync(join(root, ".amm"))).toBe(false);

    const initialized = await fetch(`${base}/workspace/ws_1/portfolio`, { method: "POST", headers, body: JSON.stringify({ name: "Studio Portfolio", defaultVertical: "publishing" }) });
    expect(initialized.status).toBe(201);
    expect(await initialized.json()).toMatchObject({ state: "ready", snapshot: { portfolio: { name: "Studio Portfolio" } } });
    expect(existsSync(join(root, ".amm", "portfolio.sqlite"))).toBe(true);
  });

  test("creates and updates generic projects", async () => {
    const { base, headers } = await setup();
    await fetch(`${base}/workspace/ws_1/portfolio`, { method: "POST", headers, body: JSON.stringify({ name: "Mixed Studio" }) });
    const createdResponse = await fetch(`${base}/workspace/ws_1/portfolio/projects`, { method: "POST", headers, body: JSON.stringify({ idempotencyKey: "project-1", title: "Moon Harbor", kind: "series", vertical: "short-drama", lifecycleStage: "planning" }) });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string };
    const updated = await fetch(`${base}/workspace/ws_1/portfolio/projects/${created.id}`, { method: "PATCH", headers, body: JSON.stringify({ expectedRevision: 1, lifecycleStage: "creation" }) });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: created.id, revision: 2, lifecycleStage: "creation" });
    const listed = await fetch(`${base}/workspace/ws_1/portfolio/projects`, { headers });
    expect(await listed.json()).toMatchObject({ items: [{ id: created.id, vertical: "short-drama" }] });
  });
});
